import type { Move } from '../schemas/move';

/**
 * The drawing types are derived from the Zod schemas in `common/schemas/` so
 * that the validated wire shape and the compile-time type cannot drift apart.
 * They are re-exported from here because this module is what the whole app
 * imports; the schemas are the definition.
 */
export type {
  CtxMode,
  CtxOptions,
  DrawPayload,
  Move,
  Shape,
} from '../schemas/move';

export interface User {
  name: string;
  color: string;
}

/**
 * The room snapshot as it crosses the wire, keyed by `userId`. The Maps do not
 * survive the socket encoder, which is why `room` also carries JSON copies of
 * them; only `drawed` is read off this object directly.
 */
export type Room = {
  usersMoves: Map<string, Move[]>;
  drawed: Move[];
  users: Map<string, User>;
};

export interface ClientRoom {
  id: string;
  usersMoves: Map<string, Move[]>;
  movesWithoutUser: Move[];
  myMoves: Move[];
  users: Map<string, User>;
}

export interface MessageType {
  userId: string;
  username: string;
  color: string;
  msg: string;
  id: number;
}

/**
 * Every `userId` below is the stable id from `common/lib/identity.ts`, never a
 * `socket.id`. The two were interchangeable until Phase 0 Step 6; they are not
 * any more, because a socket id changes on reconnect and this does not.
 */
export interface ServerToClientEvents {
  room_exists: (exists: boolean) => void;
  joined: (roomId: string, failed?: boolean) => void;
  room: (room: Room, usersMovesToParse: string, usersToParse: string) => void;
  created: (roomId: string) => void;
  your_move: (move: Move) => void;
  user_draw: (move: Move, userId: string) => void;
  user_undo(userId: string): void;
  mouse_moved: (x: number, y: number, userId: string) => void;
  /** Colour is assigned by the server so every client agrees on it. */
  new_user: (userId: string, username: string, color: string) => void;
  user_disconnected: (userId: string) => void;
  new_msg: (userId: string, msg: string) => void;
  /**
   * Sent when an event was dropped for exceeding its rate limit. Only emitted
   * for events where silence would look like a bug to the person who acted.
   */
  rate_limited: (event: string) => void;
}

export interface ClientToServerEvents {
  check_room: (roomId: string) => void;
  draw: (move: Move) => void;
  mouse_move: (x: number, y: number) => void;
  undo: () => void;
  create_room: (username: string) => void;
  join_room: (room: string, username: string) => void;
  joined_room: () => void;
  leave_room: () => void;
  send_msg: (msg: string) => void;
}
