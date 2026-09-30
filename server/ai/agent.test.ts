import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { createAnthropicAgent, type MessagesClient } from './agent';
import { fakePrograms } from './fakeAgent';
import { drawingProgramOutputSchema } from './schema';

/** A finished `Message` carrying `text` as its only content block. */
const messageWith = (
  text: string,
  overrides: Partial<Anthropic.Message> = {},
): Anthropic.Message =>
  ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 1200,
      output_tokens: 300,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 0,
    },
    ...overrides,
  }) as unknown as Anthropic.Message;

/**
 * A client whose `messages.stream` hands back one scripted outcome per call:
 * a message to resolve with, or an error to throw.
 */
const scriptedClient = (script: (Anthropic.Message | Error)[]) => {
  const stream = vi.fn(() => {
    const next = script.shift();

    return {
      finalMessage: async () => {
        if (next instanceof Error) throw next;
        if (!next) throw new Error('script exhausted');

        return next;
      },
    };
  });

  return { client: { messages: { stream } } as unknown as MessagesClient, stream };
};

const agentWith = (client: MessagesClient) =>
  createAnthropicAgent({ apiKey: 'test', model: 'claude-opus-5-5', client });

const { signal } = new AbortController();

describe('Anthropic agent', () => {
  it('returns the program on a valid answer, with usage', async () => {
    const program = fakePrograms.draw('a boat');
    const { client, stream } = scriptedClient([messageWith(JSON.stringify(program))]);

    const result = await agentWith(client).generate({ kind: 'draw', prompt: 'a boat' }, signal);

    expect(result).toEqual({
      status: 'ok',
      program,
      usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 1000 },
    });
    expect(stream).toHaveBeenCalledTimes(1);

    const [params, options] = stream.mock.calls[0] as unknown as [
      Anthropic.MessageStreamParams,
      { signal: AbortSignal },
    ];

    expect(params.model).toBe('claude-opus-5-5');
    expect(params.output_config?.effort).toBe('high');
    expect(params.output_config?.format).toBeDefined();
    expect(options.signal).toBe(signal);
    // Static system prompt is cached; the request text is in the user turn.
    expect(params.system).toEqual([
      expect.objectContaining({ cache_control: { type: 'ephemeral' } }),
    ]);
  });

  it('sends the image before the instruction when one is given', async () => {
    const { client, stream } = scriptedClient([
      messageWith(JSON.stringify(fakePrograms.cleanup())),
    ]);

    await agentWith(client).generate({ kind: 'cleanup', imageBase64: 'aGk=' }, signal);

    const [params] = stream.mock.calls[0] as unknown as [Anthropic.MessageStreamParams];
    const content = params.messages[0].content as Anthropic.ContentBlockParam[];

    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'aGk=' },
    });
    expect(content[1].type).toBe('text');
    expect(params.output_config?.effort).toBe('medium');
  });

  it('reports a refusal without retrying', async () => {
    const { client, stream } = scriptedClient([
      messageWith('', {
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'general_harms', explanation: null },
      } as Partial<Anthropic.Message>),
    ]);

    const result = await agentWith(client).generate({ kind: 'draw', prompt: 'x' }, signal);

    expect(result.status).toBe('refused');
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('retries once with the validation errors when the program is invalid, then succeeds', async () => {
    const program = fakePrograms.summarize();
    const { client, stream } = scriptedClient([
      messageWith('{"primitives": [{"type": "text", "x": 5000, "y": 0, "text": "hi", "size": 10, "color": "red"}]}'),
      messageWith(JSON.stringify(program)),
    ]);

    const result = await agentWith(client).generate({ kind: 'summarize' }, signal);

    expect(result).toMatchObject({ status: 'ok', program });
    expect(stream).toHaveBeenCalledTimes(2);

    const [retry] = stream.mock.calls[1] as unknown as [Anthropic.MessageStreamParams];
    const content = retry.messages[0].content as Anthropic.TextBlockParam[];

    expect(content[0].text).toMatch(/rejected by the validator/);
    expect(content[0].text).toMatch(/color/);
  });

  it('gives up after a second invalid answer', async () => {
    const { client, stream } = scriptedClient([messageWith('not json'), messageWith('{}')]);

    const result = await agentWith(client).generate({ kind: 'draw', prompt: 'x' }, signal);

    expect(result.status).toBe('error');
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it('strips a null note before validating', async () => {
    const { client } = scriptedClient([messageWith('{"primitives": [], "note": null}')]);

    const result = await agentWith(client).generate({ kind: 'draw', prompt: 'x' }, signal);

    expect(result).toMatchObject({ status: 'ok', program: { primitives: [] } });
  });

  it('maps a rate limit to a distinct, friendly error', async () => {
    const { client } = scriptedClient([
      new Anthropic.RateLimitError(429, { type: 'error' }, 'slow down', new Headers()),
    ]);

    const result = await agentWith(client).generate({ kind: 'draw', prompt: 'x' }, signal);

    expect(result).toEqual({ status: 'error', message: expect.stringMatching(/usage limit/) });
  });

  it('maps a connection failure and a generic API error differently', async () => {
    const connection = scriptedClient([new Anthropic.APIConnectionError({ message: 'offline' })]);
    const api = scriptedClient([
      new Anthropic.InternalServerError(500, { type: 'error' }, 'boom', new Headers()),
    ]);

    const offline = await agentWith(connection.client).generate({ kind: 'draw' }, signal);
    const failed = await agentWith(api.client).generate({ kind: 'draw' }, signal);

    expect(offline).toEqual({ status: 'error', message: expect.stringMatching(/reach the model/) });
    expect(failed).toEqual({ status: 'error', message: expect.stringMatching(/\(500\)/) });
  });

  it('reports an interruption when the signal is aborted', async () => {
    const controller = new AbortController();
    const { client } = scriptedClient([new Anthropic.APIUserAbortError()]);

    controller.abort();

    const result = await agentWith(client).generate({ kind: 'draw' }, controller.signal);

    expect(result).toEqual({ status: 'error', message: expect.stringMatching(/interrupted/) });
  });

  it('never throws on an unexpected failure', async () => {
    const { client } = scriptedClient([new TypeError('something odd')]);

    await expect(agentWith(client).generate({ kind: 'draw' }, signal)).resolves.toMatchObject({
      status: 'error',
    });
  });
});

describe('output schema', () => {
  it('converts to JSON Schema without ranges or patterns, with every property required', () => {
    const schema = JSON.stringify(drawingProgramOutputSchema.toJSONSchema());

    expect(schema).not.toMatch(/minimum|maximum|pattern|minItems|maxItems/);
    expect(schema).toMatch(/"note"/);
  });
});
