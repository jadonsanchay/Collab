import { z } from 'zod';

export const MAX_USERNAME_LENGTH = 15;
export const MAX_MESSAGE_LENGTH = 500;

/**
 * Room ids are 8 base64url characters, from 6 random bytes. The previous
 * 4-character base36 id had about 1.7 million combinations, which is small
 * enough to enumerate — strangers could walk into a private board.
 */
export const ROOM_ID_LENGTH = 8;

const ROOM_ID_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${ROOM_ID_LENGTH}}$`);

/**
 * Control and format characters go first — they are invisible, so they can be
 * used to impersonate another user or to smuggle terminal escapes into logs —
 * and what remains has to be a non-empty name after trimming.
 */
export const usernameSchema = z
  .string()
  .transform((value) => value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim())
  .pipe(z.string().min(1).max(MAX_USERNAME_LENGTH));

export const roomIdSchema = z.string().regex(ROOM_ID_PATTERN);

/**
 * The stable per-browser id from `common/lib/identity.ts`, checked at the
 * handshake. A uuid is required rather than any string so that one client
 * cannot claim to be another by sending a guessable id.
 */
export const userIdSchema = z.string().uuid();

export const chatMessageSchema = z
  .string()
  .transform((value) => value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim())
  .pipe(z.string().min(1).max(MAX_MESSAGE_LENGTH));

export type Username = z.infer<typeof usernameSchema>;
export type RoomId = z.infer<typeof roomIdSchema>;
export type UserId = z.infer<typeof userIdSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
