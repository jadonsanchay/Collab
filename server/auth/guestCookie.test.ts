import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';

import { signGuest, verifyGuest } from './guestCookie';

describe('guest cookie', () => {
  const secret = 'a-secret';

  it('round-trips a user id', () => {
    const userId = randomUUID();

    expect(verifyGuest(signGuest(userId, secret), secret)).toBe(userId);
  });

  it('rejects tampering, other secrets, and non-uuid ids', () => {
    const userId = randomUUID();
    const signed = signGuest(userId, secret);

    expect(verifyGuest(signed, 'other')).toBeNull();
    expect(verifyGuest(`${randomUUID()}.${signed.split('.')[1]}`, secret)).toBeNull();
    expect(verifyGuest(signGuest('not-a-uuid', secret), secret)).toBeNull();
    expect(verifyGuest(undefined, secret)).toBeNull();
    expect(verifyGuest('garbage', secret)).toBeNull();
  });
});
