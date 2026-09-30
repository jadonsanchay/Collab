import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';

import { fakePrograms } from './fakeAgent';
import { createOpenAiAgent, type ChatClient } from './openaiAgent';

type Completion = OpenAI.Chat.Completions.ChatCompletion;

const completionWith = (
  content: string | null,
  overrides: { refusal?: string; finish_reason?: 'stop' | 'length' } = {},
): Completion =>
  ({
    id: 'chatcmpl_1',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-5.5',
    choices: [
      {
        index: 0,
        finish_reason: overrides.finish_reason ?? 'stop',
        logprobs: null,
        message: {
          role: 'assistant',
          content,
          refusal: overrides.refusal ?? null,
        },
      },
    ],
    usage: {
      prompt_tokens: 900,
      completion_tokens: 200,
      total_tokens: 1100,
      prompt_tokens_details: { cached_tokens: 700 },
    },
  }) as unknown as Completion;

const scriptedClient = (script: (Completion | Error)[]) => {
  const create = vi.fn(async () => {
    const next = script.shift();

    if (next instanceof Error) throw next;
    if (!next) throw new Error('script exhausted');

    return next;
  });

  return {
    client: { chat: { completions: { create } } } as unknown as ChatClient,
    create,
  };
};

const agentWith = (client: ChatClient) =>
  createOpenAiAgent({ apiKey: 'test', model: 'gpt-5.5', client });

const { signal } = new AbortController();

describe('OpenAI agent', () => {
  it('returns the program on a valid answer, with usage', async () => {
    const program = fakePrograms.draw('a kite');
    const { client, create } = scriptedClient([completionWith(JSON.stringify(program))]);

    const result = await agentWith(client).generate({ kind: 'draw', prompt: 'a kite' }, signal);

    expect(result).toEqual({
      status: 'ok',
      program,
      usage: { inputTokens: 900, outputTokens: 200, cacheReadTokens: 700 },
    });

    const [params, options] = create.mock.calls[0] as unknown as [
      OpenAI.Chat.Completions.ChatCompletionCreateParams,
      { signal: AbortSignal },
    ];

    expect(params.model).toBe('gpt-5.5');
    expect(params.reasoning_effort).toBe('high');
    expect(params.response_format).toMatchObject({ type: 'json_schema' });
    expect(params.messages[0]).toMatchObject({ role: 'system' });
    expect(options.signal).toBe(signal);
  });

  it('sends the image as a data URL before the instruction', async () => {
    const { client, create } = scriptedClient([
      completionWith(JSON.stringify(fakePrograms.cleanup())),
    ]);

    await agentWith(client).generate({ kind: 'cleanup', imageBase64: 'aGk=' }, signal);

    const [params] = create.mock.calls[0] as unknown as [
      OpenAI.Chat.Completions.ChatCompletionCreateParams,
    ];
    const content = params.messages[1]
      .content as OpenAI.Chat.Completions.ChatCompletionContentPart[];

    expect(content[0]).toMatchObject({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,aGk=' },
    });
    expect(content[1].type).toBe('text');
    expect(params.reasoning_effort).toBe('medium');
  });

  it('reports a refusal without retrying', async () => {
    const { client, create } = scriptedClient([
      completionWith(null, { refusal: 'I cannot help with that.' }),
    ]);

    const result = await agentWith(client).generate({ kind: 'draw', prompt: 'x' }, signal);

    expect(result.status).toBe('refused');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('retries once with the validation errors, then succeeds', async () => {
    const program = fakePrograms.summarize();
    const { client, create } = scriptedClient([
      completionWith('{"primitives": [{"type": "rect", "x": 0, "y": 0, "w": 5, "h": 5, "stroke": "blue", "fill": null, "width": 1}]}'),
      completionWith(JSON.stringify(program)),
    ]);

    const result = await agentWith(client).generate({ kind: 'summarize' }, signal);

    expect(result).toMatchObject({ status: 'ok', program });
    expect(create).toHaveBeenCalledTimes(2);

    const [retry] = create.mock.calls[1] as unknown as [
      OpenAI.Chat.Completions.ChatCompletionCreateParams,
    ];
    const content = retry.messages[1]
      .content as OpenAI.Chat.Completions.ChatCompletionContentPartText[];

    expect(content[0].text).toMatch(/rejected by the validator/);
    expect(content[0].text).toMatch(/stroke/);
  });

  it('treats a truncated answer as invalid', async () => {
    const { client, create } = scriptedClient([
      completionWith('{"primitives": [', { finish_reason: 'length' }),
      completionWith('still not json', { finish_reason: 'length' }),
    ]);

    const result = await agentWith(client).generate({ kind: 'draw' }, signal);

    expect(result.status).toBe('error');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('maps rate limits, connection failures and API errors to distinct messages', async () => {
    const limited = scriptedClient([
      new OpenAI.RateLimitError(429, { type: 'error' }, 'slow down', new Headers()),
    ]);
    const offline = scriptedClient([new OpenAI.APIConnectionError({ message: 'offline' })]);
    const failed = scriptedClient([
      new OpenAI.InternalServerError(500, { type: 'error' }, 'boom', new Headers()),
    ]);

    await expect(agentWith(limited.client).generate({ kind: 'draw' }, signal)).resolves.toEqual({
      status: 'error',
      message: expect.stringMatching(/usage limit/),
    });
    await expect(agentWith(offline.client).generate({ kind: 'draw' }, signal)).resolves.toEqual({
      status: 'error',
      message: expect.stringMatching(/reach the model/),
    });
    await expect(agentWith(failed.client).generate({ kind: 'draw' }, signal)).resolves.toEqual({
      status: 'error',
      message: expect.stringMatching(/\(500\)/),
    });
  });

  it('never throws', async () => {
    const { client } = scriptedClient([new TypeError('odd')]);

    await expect(agentWith(client).generate({ kind: 'draw' }, signal)).resolves.toMatchObject({
      status: 'error',
    });
  });
});
