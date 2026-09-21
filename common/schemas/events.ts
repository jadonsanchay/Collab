import { z } from 'zod';

import { drawPayloadSchema } from './move';
import { chatMessageSchema, roomIdSchema, usernameSchema } from './user';

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
