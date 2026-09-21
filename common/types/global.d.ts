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

export type Room = {
  usersMoves: Map<string, Move[]>;
  drawed: Move[];
  users: Map<string, string>;
};

export interface User {
  name: string;
  color: string;
}

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

export interface ServerToClientEvents {
  room_exists: (exists: boolean) => void;
  joined: (roomId: string, failed?: boolean) => void;
  room: (room: Room, usersMovesToParse: string, usersToParse: string) => void;
  created: (roomId: string) => void;
  your_move: (move: Move) => void;
  user_draw: (move: Move, userId: string) => void;
  user_undo(userId: string): void;
  mouse_moved: (x: number, y: number, userId: string) => void;
  new_user: (userId: string, username: string) => void;
  user_disconnected: (userId: string) => void;
  new_msg: (userId: string, msg: string) => void;
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
