import { z } from 'zod';

import { ctxOptionsSchema, drawPayloadSchema, pointSchema } from './move';
import { chatMessageSchema, roomIdSchema, usernameSchema } from './user';

/**
 * Batched once per animation frame on the client, so a generous cap here is
 * about how much a single frame's worth of pointer-move coalescing could
 * produce, not a per-stroke total.
 */
const MAX_STROKE_POINTS_PER_BATCH = 200;

/**
 * One schema per inbound event, so the wire contract is readable in a single
 * place. The server validates against these; the client uses the same ones for
 * its own inputs, which is the point of them living in `common/`.
 *
 * Events with no payload (`joined_room`, `leave_room`, `undo`) need nothing
 * here — there is nothing to validate.
 */

export const checkRoomSchema = roomIdSchema;

export const createRoomSchema = usernameSchema;

export const joinRoomSchema = z.object({
  roomId: roomIdSchema,
  username: usernameSchema,
});

export const drawSchema = drawPayloadSchema;

export const rejoinRoomSchema = z.object({
  roomId: roomIdSchema,
  // A client that has applied nothing yet reports 0.
  lastSeq: z.number().int().nonnegative(),
});

export const mouseMoveSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const sendMsgSchema = chatMessageSchema;

/**
 * `strokeId` equals the `clientId` the eventual `draw` will carry, so
 * receivers can match a live preview to the committed move that replaces it.
 */
export const strokeIdSchema = z.string().uuid();

export const strokeStartSchema = z.object({
  strokeId: strokeIdSchema,
  options: ctxOptionsSchema,
  from: pointSchema,
});

export const strokePointsSchema = z.object({
  strokeId: strokeIdSchema,
  points: z.array(pointSchema).min(1).max(MAX_STROKE_POINTS_PER_BATCH),
});

export const strokeEndSchema = z.object({
  strokeId: strokeIdSchema,
});

export const cursorSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const viewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  scale: z.number().positive(),
});
