import { describe, expect, it } from 'vitest';

import { USERNAME_PATTERN } from '@/common/schemas/auth';

import { generateUsername } from './usernames';

describe('generateUsername', () => {
  it('always produces a valid handle of two adjectives and a noun', () => {
    for (let i = 0; i < 2000; i += 1) {
      const username = generateUsername();

      expect(username).toMatch(USERNAME_PATTERN);
      expect(username.split('_')).toHaveLength(3);
    }
  });

  it('never repeats the adjective and is deterministic for a fixed source', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const first = generateUsername(random);
    const [a, b] = first.split('_');

    expect(a).not.toBe(b);

    seed = 7;
    expect(generateUsername(random)).toBe(first);
  });
});
