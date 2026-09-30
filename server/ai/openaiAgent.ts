import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';

import { logger } from '../logger';
import { EFFORT, instructionFor, SYSTEM_PROMPT } from './prompts';
import {
  drawingProgramOutputSchema,
  drawingProgramSchema,
  type DrawingProgram,
} from './schema';
import type { AgentInput, AgentResult, SketchAgent } from './types';

const MAX_TOKENS = 16_000;

/** The subset of the SDK client the agent touches, so tests can fake it. */
export type ChatClient = Pick<OpenAI, 'chat'>;

type Parsed =
  | { ok: true; program: DrawingProgram }
  | { ok: false; errors: string };

const parseProgram = (text: string | null | undefined): Parsed => {
  if (!text || !text.trim()) return { ok: false, errors: 'The answer contained no JSON.' };

  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: `The answer was not valid JSON: ${(error as Error).message}` };
  }

  if (raw && typeof raw === 'object' && (raw as { note?: unknown }).note === null) {
    delete (raw as { note?: unknown }).note;
  }

  const parsed = drawingProgramSchema.safeParse(raw);

  if (parsed.success) return { ok: true, program: parsed.data };

  return {
    ok: false,
    errors: parsed.error.issues
      .slice(0, 10)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n'),
  };
};

const REFUSED_MESSAGE =
  'Sketch decided not to draw that. Try describing something else for the board.';

/**
 * The same teammate on OpenAI models, for teams whose credits live there.
 * Same prompts, same program schema, same strict validation with one repair
 * retry, same error mapping; only the transport differs. Selected with
 * `AI_PROVIDER=openai` or automatically when only `OPENAI_API_KEY` is set.
 */
export const createOpenAiAgent = ({
  apiKey,
  model,
  client = new OpenAI({ apiKey }),
}: {
  apiKey?: string;
  model: string;
  client?: ChatClient;
}): SketchAgent => {
  const ask = (input: AgentInput, signal: AbortSignal, repair?: string) => {
    const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

    if (input.imageBase64) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${input.imageBase64}`, detail: 'high' },
      });
    }

    content.push({
      type: 'text',
      text: instructionFor({
        kind: input.kind,
        prompt: input.prompt,
        recentChat: input.recentChat,
        repair,
      }),
    });

    return client.chat.completions.create(
      {
        model,
        max_completion_tokens: MAX_TOKENS,
        reasoning_effort: EFFORT[input.kind],
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content },
        ],
        response_format: zodResponseFormat(drawingProgramOutputSchema, 'drawing_program'),
      },
      { signal },
    );
  };

  const outcome = (
    completion: OpenAI.Chat.Completions.ChatCompletion,
  ): { refused: true } | { refused: false; parsed: Parsed } => {
    const choice = completion.choices[0];

    if (!choice) return { refused: false, parsed: { ok: false, errors: 'The answer was empty.' } };

    if (choice.message.refusal) return { refused: true };

    if (choice.finish_reason === 'length') {
      return {
        refused: false,
        parsed: { ok: false, errors: 'The answer was cut off before the JSON finished.' },
      };
    }

    return { refused: false, parsed: parseProgram(choice.message.content) };
  };

  return {
    name: `openai:${model}`,

    async generate(input, signal): Promise<AgentResult> {
      try {
        let completion = await ask(input, signal);
        let result = outcome(completion);

        if (result.refused) {
          logger.info({ kind: input.kind }, 'model refused an ai request');

          return { status: 'refused', message: REFUSED_MESSAGE };
        }

        if (!result.parsed.ok) {
          logger.warn(
            { kind: input.kind, errors: result.parsed.errors },
            'invalid program, retrying once',
          );

          completion = await ask(input, signal, result.parsed.errors);
          result = outcome(completion);

          if (result.refused) return { status: 'refused', message: REFUSED_MESSAGE };
        }

        if (!result.parsed.ok) {
          logger.warn(
            { kind: input.kind, errors: result.parsed.errors },
            'invalid program after retry',
          );

          return {
            status: 'error',
            message: 'Sketch could not come up with a valid drawing this time.',
          };
        }

        return {
          status: 'ok',
          program: result.parsed.program,
          usage: {
            inputTokens: completion.usage?.prompt_tokens ?? 0,
            outputTokens: completion.usage?.completion_tokens ?? 0,
            cacheReadTokens: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
          },
        };
      } catch (error) {
        if (error instanceof OpenAI.APIUserAbortError || signal.aborted) {
          return { status: 'error', message: 'Sketch was interrupted.' };
        }

        if (error instanceof OpenAI.RateLimitError) {
          logger.warn({ err: error }, 'openai rate limit');

          return {
            status: 'error',
            message: 'Sketch is over its usage limit right now. Try again in a minute.',
          };
        }

        if (error instanceof OpenAI.APIConnectionError) {
          logger.warn({ err: error }, 'openai connection error');

          return {
            status: 'error',
            message: 'Sketch could not reach the model. Check the connection and try again.',
          };
        }

        if (error instanceof OpenAI.APIError) {
          logger.error({ err: error, status: error.status }, 'openai api error');

          return {
            status: 'error',
            message: `The model returned an error${error.status ? ` (${error.status})` : ''}.`,
          };
        }

        logger.error({ err: error }, 'unexpected error in the openai agent');

        return { status: 'error', message: 'Sketch ran into an unexpected problem.' };
      }
    },
  };
};
