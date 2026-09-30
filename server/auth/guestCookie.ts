import { createHmac, timingSafeEqual } from 'crypto';

import { userIdSchema } from '@/common/schemas/user';

export const GUEST_COOKIE = 'collab_guest';

const ONE_YEAR_S = 365 * 24 * 60 * 60;

/** Used when `AUTH_SECRET` is unset: development only, and it says so. */
export const DEV_GUEST_SECRET = 'dev-only-guest-secret-change-me';

const hmac = (userId: string, secret: string) =>
  createHmac('sha256', secret).update(`guest:${userId}`).digest('base64url');

/**
 * A guest's identity for HTTP routes: the browser's stable user id, signed
 * so a request cannot claim to be another guest. The socket handshake still
 * carries the id itself; this mirrors it for pages and API routes.
 */
export const signGuest = (userId: string, secret: string) => `${userId}.${hmac(userId, secret)}`;

export const verifyGuest = (value: string | undefined, secret: string): string | null => {
  if (!value) return null;

  const dot = value.lastIndexOf('.');
  if (dot === -1) return null;

  const userId = value.slice(0, dot);
  const signature = value.slice(dot + 1);

  if (!userIdSchema.safeParse(userId).success) return null;

  const expected = Buffer.from(hmac(userId, secret));
  const given = Buffer.from(signature);

  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  return userId;
};

export const guestCookieOptions = (secure: boolean) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure,
  path: '/',
  maxAge: ONE_YEAR_S * 1000,
});
