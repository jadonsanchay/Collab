import { randomBytes } from 'crypto';
import { v4 } from 'uuid';

import { COLORS_ARRAY } from '@/common/constants/colors';
import type { DrawPayload, Move } from '@/common/types/global';

import type { RoomUser, ServerRoom } from './types';

export const MAX_ROOM_USERS = 12;

/** Why `addMove` did or did not store a move, so the caller can react. */
export type AddMoveResult =
  | { status: 'stored'; move: Move }
  | { status: 'duplicate' }
  | { status: 'no_room' };

/**
 * Picks the first colour nobody in the room is using, falling back to round
 * robin once there are more users than colours. Assigning here rather than on
 * each client is what makes everyone agree on who is which colour.
 */
const pickColor = (taken: Iterable<RoomUser>): string => {
  const used = new Set([...taken].map((user) => user.color));
  const free = COLORS_ARRAY.find((color) => !used.has(color));

  return free ?? COLORS_ARRAY[used.size % COLORS_ARRAY.length];
};

/**
 * In-memory room state with no Socket.IO dependency, which is what makes it
 * unit-testable here and swappable for a Postgres-backed implementation behind
 * the same interface in Phase 3.
 *
 * Everything is keyed by the stable `userId` from the handshake. Every mutation
 * reports whether it happened, and nothing assumes a room or a move list
 * exists, so no client message can reach an unguarded lookup.
 */
export class RoomStore {
  private rooms = new Map<string, ServerRoom>();

  has(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  get(roomId: string): ServerRoom | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Creates a room owned by `userId` and returns its id with the owner's
   * assigned colour.
   *
   * Six random bytes give 8 base64url characters. The previous 4-character
   * `Math.random` id had ~1.7 million combinations, which is small enough to
   * enumerate, so strangers could find their way into a board.
   */
  create(
    userId: string,
    username: string,
  ): { roomId: string; user: RoomUser } {
    let roomId: string;
    do {
      roomId = randomBytes(6).toString('base64url');
    } while (this.rooms.has(roomId));

    const user: RoomUser = {
      userId,
      name: username,
      color: pickColor([]),
    };

    this.rooms.set(roomId, {
      users: new Map([[userId, user]]),
      usersMoves: new Map([[userId, []]]),
      drawed: [],
      seq: 0,
      clientIds: new Set(),
    });

    return { roomId, user };
  }

  /**
   * Returns the joined user, or null when the room does not exist or is full.
   * Rejoining with an id already in the room keeps the original colour, so a
   * user does not change colour by coming back.
   */
  join(roomId: string, userId: string, username: string): RoomUser | null {
    const room = this.rooms.get(roomId);

    if (!room) return null;

    const existing = room.users.get(userId);

    if (existing) {
      const rejoined = { ...existing, name: username };
      room.users.set(userId, rejoined);

      return rejoined;
    }

    if (room.users.size >= MAX_ROOM_USERS) return null;

    const user: RoomUser = {
      userId,
      name: username,
      color: pickColor(room.users.values()),
    };

    room.users.set(userId, user);
    if (!room.usersMoves.has(userId)) room.usersMoves.set(userId, []);

    return user;
  }

  /**
   * Folds the user's moves into `drawed` so their drawing survives them
   * leaving, then drops the user entirely. Returns false when the room is
   * unknown, which is how the caller knows not to bother with `socket.leave`.
   *
   * Dropping the `usersMoves` entry matters: leaving it behind would put the
   * same moves in `drawed` *and* under the departed user, and the client loads
   * both halves of a snapshot, so every joiner would replay those strokes
   * twice.
   */
  leave(roomId: string, userId: string): boolean {
    const room = this.rooms.get(roomId);

    if (!room) return false;

    const userMoves = room.usersMoves.get(userId);
    if (userMoves) room.drawed.push(...userMoves);

    room.usersMoves.delete(userId);
    room.users.delete(userId);

    return true;
  }

  /**
   * Stamps a validated payload with the fields only the server may set and
   * stores it. A `clientId` this room has already accepted is reported as a
   * duplicate rather than stored again, which is what makes a resend safe.
   */
  addMove(roomId: string, userId: string, payload: DrawPayload): AddMoveResult {
    const room = this.rooms.get(roomId);

    if (!room) return { status: 'no_room' };

    if (room.clientIds.has(payload.clientId)) return { status: 'duplicate' };

    room.seq += 1;

    const move: Move = {
      ...payload,
      id: v4(),
      timestamp: Date.now(),
      seq: room.seq,
    };

    const userMoves = room.usersMoves.get(userId);

    if (userMoves) userMoves.push(move);
    else room.usersMoves.set(userId, [move]);

    room.clientIds.add(payload.clientId);

    return { status: 'stored', move };
  }

  /** Returns false when there is no room or no move list to pop from. */
  undoMove(roomId: string, userId: string): boolean {
    const room = this.rooms.get(roomId);

    if (!room) return false;

    const userMoves = room.usersMoves.get(userId);

    if (!userMoves) return false;

    // A pop on an empty list is a no-op, which is what it was before these
    // guards: an undo with nothing left to undo still broadcasts.
    const undone = userMoves.pop();

    // Release the clientId so a redo of this move is not mistaken for a
    // duplicate. The client sends a fresh one anyway, but a stale entry here
    // would keep the room's dedupe set growing for moves that no longer exist.
    if (undone) room.clientIds.delete(undone.clientId);

    return true;
  }
}
