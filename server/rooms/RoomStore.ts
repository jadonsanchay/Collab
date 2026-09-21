import { randomBytes } from 'crypto';

import type { Move } from '@/common/types/global';

import type { ServerRoom } from './types';

export const MAX_ROOM_USERS = 12;

/**
 * In-memory room state with no Socket.IO dependency, which is what makes it
 * unit-testable here and swappable for a Postgres-backed implementation behind
 * the same interface in Phase 3.
 *
 * Every mutation reports whether it happened. Nothing here throws on missing
 * state and nothing assumes a room or a move list exists, so no client message
 * can reach an unguarded lookup.
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
   * Creates a room owned by `socketId` and returns its generated id.
   *
   * Six random bytes give 8 base64url characters. The previous 4-character
   * `Math.random` id had ~1.7 million combinations, which is small enough to
   * enumerate, so strangers could find their way into a board.
   */
  create(socketId: string, username: string): string {
    let roomId: string;
    do {
      roomId = randomBytes(6).toString('base64url');
    } while (this.rooms.has(roomId));

    this.rooms.set(roomId, {
      usersMoves: new Map([[socketId, []]]),
      drawed: [],
      users: new Map([[socketId, username]]),
    });

    return roomId;
  }

  /** Returns false when the room does not exist or is already full. */
  join(roomId: string, socketId: string, username: string): boolean {
    const room = this.rooms.get(roomId);

    if (!room || room.users.size >= MAX_ROOM_USERS) return false;

    room.users.set(socketId, username);
    room.usersMoves.set(socketId, []);

    return true;
  }

  /**
   * Folds the user's moves into `drawed` so their drawing survives them
   * leaving, then drops the user entirely. Returns false when the room is
   * unknown, which is how the caller knows not to bother with `socket.leave`.
   *
   * Dropping the `usersMoves` entry matters: leaving it behind would put the
   * same moves in `drawed` *and* under the departed socket id, and the client
   * loads both halves of a snapshot, so every joiner would replay those
   * strokes twice.
   */
  leave(roomId: string, socketId: string): boolean {
    const room = this.rooms.get(roomId);

    if (!room) return false;

    const userMoves = room.usersMoves.get(socketId);
    if (userMoves) room.drawed.push(...userMoves);

    room.usersMoves.delete(socketId);
    room.users.delete(socketId);

    return true;
  }

  /**
   * Returns false when the room is gone. The caller must not broadcast in that
   * case: a move the server never stored would leave clients rendering a stroke
   * that no later snapshot replays.
   */
  addMove(roomId: string, socketId: string, move: Move): boolean {
    const room = this.rooms.get(roomId);

    if (!room) return false;

    const userMoves = room.usersMoves.get(socketId);

    if (userMoves) userMoves.push(move);
    else room.usersMoves.set(socketId, [move]);

    return true;
  }

  /** Returns false when there is no room or no move list to pop from. */
  undoMove(roomId: string, socketId: string): boolean {
    const room = this.rooms.get(roomId);

    if (!room) return false;

    const userMoves = room.usersMoves.get(socketId);

    if (!userMoves) return false;

    // A pop on an empty list is a no-op, which is what it was before these
    // guards: an undo with nothing left to undo still broadcasts.
    userMoves.pop();

    return true;
  }
}
