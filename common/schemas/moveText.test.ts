import { describe, expect, it } from 'vitest';

import { makeMove } from '@/server/testing/fixtures';

import { drawPayloadSchema, MAX_TEXT_LENGTH, moveSchema } from './move';

describe('text moves and server-owned fields', () => {
  it('accepts a text move payload', () => {
    const payload = makeMove({
      path: [[10, 20]],
      text: { content: 'hello\nworld', fontSize: 24 },
      options: { ...makeMove().options, shape: 'text' },
    });

    const parsed = drawPayloadSchema.safeParse(payload);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.text).toEqual({ content: 'hello\nworld', fontSize: 24 });
  });

  it('rejects text longer than the cap and a non-positive font size', () => {
    const base = makeMove().options;

    expect(
      drawPayloadSchema.safeParse(
        makeMove({
          text: { content: 'x'.repeat(MAX_TEXT_LENGTH + 1), fontSize: 12 },
          options: { ...base, shape: 'text' },
        }),
      ).success,
    ).toBe(false);

    expect(
      drawPayloadSchema.safeParse(
        makeMove({
          text: { content: 'ok', fontSize: 0 },
          options: { ...base, shape: 'text' },
        }),
      ).success,
    ).toBe(false);
  });

  it('strips a client-supplied userId and meta from a draw payload', () => {
    const parsed = drawPayloadSchema.safeParse({
      ...makeMove(),
      userId: 'someone-else',
      meta: { requestId: 'forged' },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect('userId' in parsed.data).toBe(false);
    expect('meta' in parsed.data).toBe(false);
  });

  it('requires userId on a full move', () => {
    const { userId, ...withoutUser } = makeMove();

    expect(userId).toBe('');
    expect(moveSchema.safeParse(withoutUser).success).toBe(false);
    expect(moveSchema.safeParse({ ...withoutUser, userId: 'u1' }).success).toBe(
      true,
    );
  });
});
