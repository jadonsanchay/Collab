import { describe, expect, it } from 'vitest';

import { makeMove } from '@/server/testing/fixtures';

import {
  drawPayloadSchema,
  MAX_IMAGE_BASE64_LENGTH,
  MAX_LINE_WIDTH,
  MAX_PATH_POINTS,
  moveSchema,
} from './move';
import {
  chatMessageSchema,
  MAX_MESSAGE_LENGTH,
  MAX_USERNAME_LENGTH,
  roomIdSchema,
  usernameSchema,
} from './user';

describe('moveSchema', () => {
  it('accepts a move the client actually builds', () => {
    // Guards against the schema drifting stricter than the app: `makeMove`
    // mirrors DEFAULT_MOVE, which is the base of every move the client sends.
    expect(moveSchema.safeParse(makeMove()).success).toBe(true);
  });

  it('accepts negative geometry, which means a drag up or left', () => {
    const move = makeMove({
      rect: { width: -120, height: -40 },
      path: [
        [-10, -20],
        [-30, -40],
      ],
    });

    expect(moveSchema.safeParse(move).success).toBe(true);
  });

  it.each([
    ['NaN coordinates', { path: [[NaN, 0]] }],
    ['infinite coordinates', { path: [[Infinity, 0]] }],
    ['a one-dimensional point', { path: [[1]] }],
    ['a path of the wrong type', { path: 'not-a-path' }],
    ['a missing options block', { options: undefined }],
    ['an unknown shape', { options: { ...makeMove().options, shape: 'blob' } }],
    ['an unknown mode', { options: { ...makeMove().options, mode: 'fly' } }],
    [
      'an out-of-range colour channel',
      { options: { ...makeMove().options, lineColor: { r: 300, g: 0, b: 0, a: 1 } } },
    ],
    [
      'an out-of-range alpha',
      { options: { ...makeMove().options, lineColor: { r: 0, g: 0, b: 0, a: 4 } } },
    ],
    [
      'a line width beyond the cap',
      { options: { ...makeMove().options, lineWidth: MAX_LINE_WIDTH + 1 } },
    ],
    [
      'a zero line width',
      { options: { ...makeMove().options, lineWidth: 0 } },
    ],
  ])('rejects %s', (_label, overrides) => {
    const move = { ...makeMove(), ...(overrides as object) };

    expect(moveSchema.safeParse(move).success).toBe(false);
  });

  it(`rejects a path longer than ${MAX_PATH_POINTS} points`, () => {
    const tooLong = makeMove({
      path: Array.from({ length: MAX_PATH_POINTS + 1 }, () => [0, 0] as [number, number]),
    });
    const atLimit = makeMove({
      path: Array.from({ length: MAX_PATH_POINTS }, () => [0, 0] as [number, number]),
    });

    expect(moveSchema.safeParse(tooLong).success).toBe(false);
    expect(moveSchema.safeParse(atLimit).success).toBe(true);
  });

  it('rejects an oversized image', () => {
    const move = makeMove({
      img: { base64: 'x'.repeat(MAX_IMAGE_BASE64_LENGTH + 1) },
    });

    expect(moveSchema.safeParse(move).success).toBe(false);
  });

  it('strips unknown keys rather than rejecting them', () => {
    const parsed = moveSchema.safeParse({ ...makeMove(), injected: 'nope' });

    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty('injected');
  });
});

describe('drawPayloadSchema', () => {
  it('drops a client-supplied id and timestamp so neither can be forged', () => {
    const parsed = drawPayloadSchema.safeParse(
      makeMove({ id: 'forged-id', timestamp: 999 }),
    );

    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty('id');
    expect(parsed.data).not.toHaveProperty('timestamp');
  });

  it('accepts a payload that omits them entirely', () => {
    const { id, timestamp, ...withoutServerFields } = makeMove();

    expect(id).toBeDefined();
    expect(timestamp).toBeDefined();
    expect(drawPayloadSchema.safeParse(withoutServerFields).success).toBe(true);
  });
});

describe('usernameSchema', () => {
  it('trims surrounding whitespace', () => {
    expect(usernameSchema.parse('  Alice  ')).toBe('Alice');
  });

  it('strips control and format characters used to fake a name', () => {
    // A zero-width joiner and a right-to-left override are invisible, so they
    // let one user render as another.
    expect(usernameSchema.parse('Al‍ice‮')).toBe('Alice');
  });

  it.each([
    ['an empty string', ''],
    ['only whitespace', '   '],
    ['only invisible characters', '​‍'],
    ['a name past the cap', 'x'.repeat(MAX_USERNAME_LENGTH + 1)],
    ['a number', 42],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(usernameSchema.safeParse(value).success).toBe(false);
  });

  it('accepts a name exactly at the cap', () => {
    expect(usernameSchema.safeParse('x'.repeat(MAX_USERNAME_LENGTH)).success).toBe(
      true,
    );
  });
});

describe('roomIdSchema', () => {
  it('accepts an 8-character base64url id', () => {
    expect(roomIdSchema.safeParse('aB3-_xYz').success).toBe(true);
  });

  it.each([
    ['the old 4-character format', 'ab12'],
    ['too many characters', 'aB3-_xYz9'],
    ['a base64 padding character', 'aB3-_xY='],
    ['a slash from standard base64', 'aB3/_xYz'],
    ['an empty string', ''],
    ['a number', 12345678],
  ])('rejects %s', (_label, value) => {
    expect(roomIdSchema.safeParse(value).success).toBe(false);
  });
});

describe('chatMessageSchema', () => {
  it('trims the message', () => {
    expect(chatMessageSchema.parse('  hello  ')).toBe('hello');
  });

  it.each([
    ['an empty message', ''],
    ['a whitespace-only message', '   \n  '],
    ['a message past the cap', 'x'.repeat(MAX_MESSAGE_LENGTH + 1)],
  ])('rejects %s', (_label, value) => {
    expect(chatMessageSchema.safeParse(value).success).toBe(false);
  });
});
