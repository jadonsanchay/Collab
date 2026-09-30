import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { logger } from '../logger';
import { EFFORT, instructionFor, SYSTEM_PROMPT } from './prompts';
import {
  drawingProgramOutputSchema,
  drawingProgramSchema,
  type DrawingProgram,
} from './schema';
import type { AgentInput, AgentResult, SketchAgent } from './types';

/** Room for a 150-primitive program with thinking on; streaming keeps it safe. */
const MAX_TOKENS = 16_000;

/** The subset of the SDK client the agent touches, so tests can fake it. */
export type MessagesClient = Pick<Anthropic, 'messages'>;

type Parsed =
  | { ok: true; program: DrawingProgram }
  | { ok: false; errors: string };

/** Finds the JSON text block, parses it, and applies the strict schema. */
const parseProgram = (message: Anthropic.Message): Parsed => {
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  if (!text.trim()) return { ok: false, errors: 'The answer contained no JSON.' };

  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: `The answer was not valid JSON: ${(error as Error).message}` };
  }

  // The output format uses a nullable note; the strict schema wants it absent.
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

const usageOf = (message: Anthropic.Message) => ({
  inputTokens: message.usage.input_tokens,
  outputTokens: message.usage.output_tokens,
  cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
});

const REFUSED_MESSAGE =
  "Sketch decided not to draw that. Try describing something else for the board.";

/**
 * The real teammate: one streamed Messages call with structured output,
 * image plus instruction, a cached static system prompt, and one repair
 * retry when the program fails the strict schema. Never throws: every
 * failure becomes an `AgentResult` the room can be told about.
 */
export const createAnthropicAgent = ({
  apiKey,
  model,
  client = new Anthropic({ apiKey }),
}: {
  apiKey?: string;
  model: string;
  client?: MessagesClient;
}): SketchAgent => {
  const ask = async (
    input: AgentInput,
    signal: AbortSignal,
    repair?: string,
  ): Promise<Anthropic.Message> => {
    const content: Anthropic.ContentBlockParam[] = [];

    if (input.imageBase64) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: input.imageBase64 },
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

    const stream = client.messages.stream(
      {
        model,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content }],
        output_config: {
          effort: EFFORT[input.kind],
          format: zodOutputFormat(drawingProgramOutputSchema),
        },
      },
      { signal },
    );

    return stream.finalMessage();
  };

  return {
    name: `anthropic:${model}`,

    async generate(input, signal): Promise<AgentResult> {
      try {
        let message = await ask(input, signal);

        if (message.stop_reason === 'refusal') {
          logger.info(
            { kind: input.kind, category: message.stop_details?.category },
            'model refused an ai request',
          );

          return { status: 'refused', message: REFUSED_MESSAGE };
        }

        let parsed = parseProgram(message);

        if (!parsed.ok) {
          logger.warn({ kind: input.kind, errors: parsed.errors }, 'invalid program, retrying once');

          message = await ask(input, signal, parsed.errors);

          if (message.stop_reason === 'refusal') {
            return { status: 'refused', message: REFUSED_MESSAGE };
          }

          parsed = parseProgram(message);
        }

        if (!parsed.ok) {
          logger.warn({ kind: input.kind, errors: parsed.errors }, 'invalid program after retry');

          return {
            status: 'error',
            message: 'Sketch could not come up with a valid drawing this time.',
          };
        }

        return { status: 'ok', program: parsed.program, usage: usageOf(message) };
      } catch (error) {
        if (error instanceof Anthropic.APIUserAbortError || signal.aborted) {
          return { status: 'error', message: 'Sketch was interrupted.' };
        }

        if (error instanceof Anthropic.RateLimitError) {
          logger.warn({ err: error }, 'anthropic rate limit');

          return {
            status: 'error',
            message: 'Sketch is over its usage limit right now. Try again in a minute.',
          };
        }

        if (error instanceof Anthropic.APIConnectionError) {
          logger.warn({ err: error }, 'anthropic connection error');

          return {
            status: 'error',
            message: 'Sketch could not reach the model. Check the connection and try again.',
          };
        }

        if (error instanceof Anthropic.APIError) {
          logger.error({ err: error, status: error.status }, 'anthropic api error');

          return {
            status: 'error',
            message: `The model returned an error${error.status ? ` (${error.status})` : ''}.`,
          };
        }

        logger.error({ err: error }, 'unexpected error in the anthropic agent');

        return { status: 'error', message: 'Sketch ran into an unexpected problem.' };
      }
    },
  };
};
