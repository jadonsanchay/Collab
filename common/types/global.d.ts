import type { Role } from '../constants/roles';
import type { AiKind, AiRequest, AiStatus } from '../schemas/ai';
import type { CtxOptions, Move, Point } from '../schemas/move';

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
  MoveMeta,
  MoveText,
  Point,
  Shape,
} from '../schemas/move';

export type { AiKind, AiRequest, AiStatus, BoardRect } from '../schemas/ai';
export type { GrantableRole, Role } from '../constants/roles';

/** Why a join was refused, when the reason is worth telling the user. */
export type JoinRefusal = 'not_found' | 'full' | 'forbidden';

/** Extra facts about a successful join: what the caller may do here. */
export interface JoinMeta {
  role?: Role;
  reason?: JoinRefusal;
}

/**
 * Which optional features this server has switched on. Sent once per
 * connection so flags never ship in the client bundle: the UI for a feature
 * renders only when the server says it exists.
 */
export interface Features {
  ai: boolean;
  rewind: boolean;
  /** Sign-in exists on this server. Guests work either way. */
  auth?: boolean;
  /** Boards outlive the process: the dashboard and templates make sense. */
  persistent?: boolean;
  /** A call can be joined from this board (LiveKit configured). */
  rtc?: boolean;
  /** Which node answered, once there is more than one (Phase 3). */
  node?: string;
}

/**
 * Who the server decided this connection is. Sent once per connection,
 * right after `features`. A guest keeps the browser's stable id; a signed-in
 * user gets their account id, which the client adopts so everything it
 * keys by "me" agrees with the server.
 */
export interface Identity {
  userId: string;
  isGuest: boolean;
  name: string | null;
  email: string | null;
  image: string | null;
}

/** Progress of one AI request, broadcast to the whole room. */
export interface AiStatusUpdate {
  requestId: string;
  /** Who asked. Clients use it to decide whose toasts to show. */
  userId: string;
  kind: AiKind;
  status: AiStatus;
  message?: string;
  progress?: { done: number; total: number };
}

export interface User {
  name: string;
  color: string;
  /** Set while the user is inside their disconnect grace window. */
  offline?: boolean;
}

/** One chat line as stored and as replayed to late joiners. */
export interface ChatMessage {
  id: string;
  userId: string;
  /** The author's name at the time, so a departed user is still attributed. */
  name: string;
  body: string;
  createdAt: number;
}

/**
 * The room snapshot as it crosses the wire, keyed by `userId`. The Maps do not
 * survive the socket encoder, which is why `room` also carries JSON copies of
 * them; only `drawed`, `title` and `chat` are read off this object directly.
 */
export type Room = {
  usersMoves: Map<string, Move[]>;
  drawed: Move[];
  users: Map<string, User>;
  title?: string;
  chat?: ChatMessage[];
};

export interface ClientRoom {
  id: string;
  title?: string;
  /** What this client may do here, as the server said on join. */
  myRole?: Role;
  usersMoves: Map<string, Move[]>;
  movesWithoutUser: Move[];
  myMoves: Move[];
  users: Map<string, User>;
}

/**
 * Every `userId` below is the stable id from `common/lib/identity.ts`, never a
 * `socket.id`. The two were interchangeable until Phase 0 Step 6; they are not
 * any more, because a socket id changes on reconnect and this does not.
 */
export interface ServerToClientEvents {
  room_exists: (exists: boolean) => void;
  /** `meta` is additive: older clients read only the first two arguments. */
  joined: (roomId: string, failed?: boolean, meta?: JoinMeta) => void;
  room: (room: Room, usersMovesToParse: string, usersToParse: string) => void;
  created: (roomId: string) => void;
  your_move: (move: Move) => void;
  user_draw: (move: Move, userId: string) => void;
  user_undo(userId: string): void;
  /** Colour is assigned by the server so every client agrees on it. */
  new_user: (userId: string, username: string, color: string) => void;
  /**
   * What a reconnecting client missed: moves after the sequence number it
   * reported, grouped by author, plus the current user list. Sending only the
   * gap avoids replaying a whole board to resume a session.
   */
  room_delta: (
    usersMovesToParse: string,
    drawedToParse: string,
    usersToParse: string,
  ) => void;
  /**
   * The user's socket dropped but their place in the room is being held. Both
   * of these are additive: `user_disconnected` still means gone for good.
   */
  user_offline: (userId: string) => void;
  user_online: (userId: string) => void;
  user_disconnected: (userId: string) => void;
  new_msg: (userId: string, msg: string) => void;
  /**
   * Sent when an event was dropped for exceeding its rate limit. Only emitted
   * for events where silence would look like a bug to the person who acted.
   */
  rate_limited: (event: string) => void;
  /**
   * A remote stroke still in progress. `strokeId` equals the `clientId` the
   * eventual `draw`/`user_draw` will carry, so a receiver removes the live
   * preview once the committed move for it arrives (or after a timeout if it
   * never does). All three are volatile: the server relays and stores
   * nothing, so a dropped packet just means a slightly less smooth preview,
   * never a wrong committed board.
   */
  live_stroke_start: (
    userId: string,
    strokeId: string,
    options: CtxOptions,
    from: Point,
  ) => void;
  live_stroke_points: (userId: string, strokeId: string, points: Point[]) => void;
  live_stroke_end: (userId: string, strokeId: string) => void;
  /** Volatile presence broadcasts: a dropped packet just means one skipped frame. */
  cursor_moved: (userId: string, x: number, y: number) => void;
  viewport_changed: (userId: string, x: number, y: number, scale: number) => void;
  /** Asks everyone else to bring their viewport to the sender's. */
  summoned: (byUserId: string) => void;
  /**
   * The server removed these moves, by id, from the room. Unlike `user_undo`
   * this can name any move by any author; it exists so a batch of AI moves
   * can be undone as one action. Clients drop them from every list they hold.
   */
  moves_removed: (moveIds: string[]) => void;
  /** Sent once on connect. See `Features`. */
  features: (features: Features) => void;
  /** Sent once on connect, after `features`. See `Identity`. */
  identity: (identity: Identity) => void;
  ai_status: (update: AiStatusUpdate) => void;
  /** The caller's role does not allow what they just tried. */
  denied: (action: string, role: Role) => void;
  /** The board was renamed by its owner. */
  room_renamed: (title: string) => void;
  /** The owner deleted the board; everyone in it is sent home. */
  board_deleted: () => void;
  /** The owner muted this user's track in the call. Only the target is told. */
  rtc_moderated: (targetUserId: string, track: 'audio' | 'video') => void;
  /** Who is in the board's call right now, from the call server's webhooks. */
  call_participants: (userIds: string[]) => void;
}

export interface ClientToServerEvents {
  check_room: (roomId: string) => void;
  draw: (move: Move) => void;
  undo: () => void;
  create_room: (username: string) => void;
  join_room: (room: string, username: string) => void;
  joined_room: () => void;
  /**
   * Asks to resume an existing session after a reconnect, reporting the
   * highest sequence number this client has already applied.
   */
  rejoin_room: (roomId: string, lastSeq: number) => void;
  leave_room: () => void;
  send_msg: (msg: string) => void;
  /**
   * A stroke's live preview, relayed to everyone else in the room but never
   * stored: the committed `draw` that follows is the source of truth.
   */
  stroke_start: (strokeId: string, options: CtxOptions, from: Point) => void;
  stroke_points: (strokeId: string, points: Point[]) => void;
  stroke_end: (strokeId: string) => void;
  cursor: (x: number, y: number) => void;
  viewport: (x: number, y: number, scale: number) => void;
  summon: () => void;
  /** Asks Sketch for something. Ignored when the server has AI switched off. */
  ai_request: (request: AiRequest) => void;
  /** Removes everything one request drew. Only the requester may send it. */
  ai_undo: (requestId: string) => void;
  /** Owner only. */
  rename_room: (title: string) => void;
}
