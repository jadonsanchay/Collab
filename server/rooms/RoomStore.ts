import { randomBytes } from 'crypto';
import { v4 } from 'uuid';

import { COLORS_ARRAY } from '@/common/constants/colors';
import { DEFAULT_MOVE } from '@/common/constants/defaultMove';
import { SNAPSHOT_USER_ID } from '@/common/constants/system';
import type {
  BoardEngine,
  ChatMessage,
  DrawPayload,
  Move,
  MoveMeta,
} from '@/common/types/global';

import type { RoomUser, ServerRoom } from './types';

export const MAX_ROOM_USERS = 12;

/** Chat lines kept per room and replayed to late joiners. */
export const MAX_CHAT_HISTORY = 100;

export const DEFAULT_TITLE = 'Untitled board';

/** A server-rendered picture of everything up to `seq`. */
export type RoomSnapshot = {
  url: string;
  seq: number;
  width: number;
  height: number;
};

/** What a persistence layer hands back to rebuild a room in memory. */
export type HydratedRoom = {
  title: string;
  ownerId: string | null;
  engine?: BoardEngine;
  seq: number;
  /** Every surviving move after the snapshot (or all of them), any order; all carry `userId`. */
  moves: Move[];
  chat: ChatMessage[];
  snapshot?: RoomSnapshot | null;
};

/**
 * The compacted history as a move: an image at the origin with the
 * snapshot's sequence number, so it sorts before everything drawn since
 * and needs no special handling from any renderer.
 */
export const snapshotMove = (snapshot: RoomSnapshot): Move => ({
  ...DEFAULT_MOVE,
  id: `snapshot:${snapshot.seq}`,
  clientId: `snapshot:${snapshot.seq}`,
  seq: snapshot.seq,
  userId: SNAPSHOT_USER_ID,
  path: [[0, 0]],
  img: { url: snapshot.url, width: snapshot.width, height: snapshot.height },
  options: { ...DEFAULT_MOVE.options, shape: 'image', mode: 'draw' },
});

export type RoomStoreOptions = {
  /** How long a disconnected user keeps their place. */
  userGraceMs: number;
  /** How long an empty room is kept. */
  roomGraceMs: number;
  /** How often expired users and empty rooms are looked for. */
  sweepIntervalMs: number;
  /**
   * Called when a user's grace window expires and they are removed for good,
   * so the caller can tell the room. The store stays free of any Socket.IO
   * dependency; this is how the broadcast happens without one.
   */
  onUserFinalized?: (roomId: string, userId: string) => void;
};

const DEFAULT_OPTIONS: RoomStoreOptions = {
  userGraceMs: 60_000,
  roomGraceMs: 30 * 60_000,
  sweepIntervalMs: 60_000,
};

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

/** Members who are people: the ones the cap and the empty-room clock count. */
const humanCount = (room: ServerRoom) =>
  [...room.users.values()].filter((user) => !user.synthetic).length;

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

  private options: RoomStoreOptions;

  private sweeper: NodeJS.Timeout | null = null;

  constructor(options: Partial<RoomStoreOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    this.sweeper = setInterval(
      () => this.sweep(),
      this.options.sweepIntervalMs,
    );

    // Never let the sweeper be the reason the process stays alive.
    this.sweeper.unref?.();
  }

  /** Clears the sweeper and every pending finalize. */
  stop() {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;

    this.rooms.forEach((room) => {
      room.users.forEach((user) => {
        if (user.finalizeTimer) clearTimeout(user.finalizeTimer);
      });
    });
  }

  /** Deletes empty rooms whose grace window has passed. */
  private sweep(now = Date.now()) {
    this.rooms.forEach((room, roomId) => {
      if (
        room.emptySince !== null &&
        now - room.emptySince >= this.options.roomGraceMs
      ) {
        this.delete(roomId);
      }
    });
  }

  /**
   * Removes a room and clears anything still pointing at it. Exposed mostly so
   * the sweeper and tests share one code path.
   */
  delete(roomId: string) {
    const room = this.rooms.get(roomId);

    if (!room) return;

    room.users.forEach((user) => {
      if (user.finalizeTimer) clearTimeout(user.finalizeTimer);
    });

    this.rooms.delete(roomId);
  }

  /** Rooms held in memory right now. */
  get size(): number {
    return this.rooms.size;
  }

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
    socketId: string,
    options: { title?: string; roomId?: string; engine?: BoardEngine } = {},
  ): { roomId: string; user: RoomUser } {
    let roomId = options.roomId ?? '';

    if (!roomId || this.rooms.has(roomId)) {
      do {
        roomId = randomBytes(6).toString('base64url');
      } while (this.rooms.has(roomId));
    }

    const user: RoomUser = {
      userId,
      name: username,
      color: pickColor([]),
      socketId,
      disconnectedAt: null,
      finalizeTimer: null,
      synthetic: false,
    };

    this.rooms.set(roomId, {
      engine: options.engine ?? 'raster',
      title: options.title?.trim() || DEFAULT_TITLE,
      ownerId: userId,
      chat: [],
      users: new Map([[userId, user]]),
      usersMoves: new Map([[userId, []]]),
      drawed: [],
      seq: 0,
      snapshotSeq: 0,
      clientIds: new Set(),
      emptySince: null,
    });

    return { roomId, user };
  }

  /**
   * Rebuilds a room from persisted state, with nobody in it. Every move goes
   * into `drawed`: its author may return, but their undo history did not
   * survive the restart, and `drawed` is where authorless-for-now moves
   * live. The empty-room clock starts at once so an abandoned board is
   * evicted from memory again after the grace window.
   */
  hydrate(roomId: string, data: HydratedRoom, now = Date.now()): ServerRoom {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;

    const tail = [...data.moves].sort((a, b) => a.seq - b.seq);
    const drawed = data.snapshot ? [snapshotMove(data.snapshot), ...tail] : tail;
    const highest = drawed.reduce((max, move) => Math.max(max, move.seq), 0);

    const room: ServerRoom = {
      engine: data.engine ?? 'raster',
      title: data.title || DEFAULT_TITLE,
      ownerId: data.ownerId,
      chat: data.chat.slice(-MAX_CHAT_HISTORY),
      users: new Map(),
      usersMoves: new Map(),
      drawed,
      seq: Math.max(data.seq, highest),
      snapshotSeq: data.snapshot?.seq ?? 0,
      clientIds: new Set(drawed.map((move) => move.clientId)),
      emptySince: now,
    };

    this.rooms.set(roomId, room);

    return room;
  }

  /** Renames a room. False when there is no such room. */
  rename(roomId: string, title: string): boolean {
    const room = this.rooms.get(roomId);

    if (!room) return false;

    room.title = title.trim() || DEFAULT_TITLE;

    return true;
  }

  /** Switches a room's engine; the caller has already converted its content. */
  setEngine(roomId: string, engine: BoardEngine): boolean {
    const room = this.rooms.get(roomId);

    if (!room) return false;

    room.engine = engine;

    return true;
  }

  /** Appends a chat line, keeping only the most recent `MAX_CHAT_HISTORY`. */
  appendChat(roomId: string, message: ChatMessage): boolean {
    const room = this.rooms.get(roomId);

    if (!room) return false;

    room.chat.push(message);
    if (room.chat.length > MAX_CHAT_HISTORY) {
      room.chat.splice(0, room.chat.length - MAX_CHAT_HISTORY);
    }

    return true;
  }

  /**
   * A guest signed in: everything in memory under the old id becomes the
   * account's, in every loaded room. The persistent record is merged
   * separately; this keeps the rooms people are looking at right now in step.
   */
  reattribute(fromUserId: string, toUserId: string) {
    if (fromUserId === toUserId) return;

    // Looked up by id inside the loop rather than taken as the callback's
    // parameter: the room record is mutated in place, and the lint rule
    // against mutating parameters is one worth keeping everywhere else.
    [...this.rooms.keys()].forEach((roomId) => {
      const room = this.rooms.get(roomId);
      if (!room) return;

      const relabel = (move: Move): Move =>
        move.userId === fromUserId ? { ...move, userId: toUserId } : move;

      room.drawed = room.drawed.map(relabel);

      const fromMoves = room.usersMoves.get(fromUserId);

      if (fromMoves) {
        const merged = [...(room.usersMoves.get(toUserId) ?? []), ...fromMoves.map(relabel)].sort(
          (a, b) => a.seq - b.seq,
        );

        room.usersMoves.set(toUserId, merged);
        room.usersMoves.delete(fromUserId);
      }

      room.usersMoves.forEach((moves, userId) => {
        room.usersMoves.set(userId, moves.map(relabel));
      });

      const fromUser = room.users.get(fromUserId);

      if (fromUser) {
        if (fromUser.finalizeTimer) clearTimeout(fromUser.finalizeTimer);
        room.users.delete(fromUserId);

        if (!room.users.has(toUserId)) {
          room.users.set(toUserId, { ...fromUser, userId: toUserId, finalizeTimer: null });
        }
      }

      if (room.ownerId === fromUserId) room.ownerId = toUserId;

      room.chat = room.chat.map((message) =>
        message.userId === fromUserId ? { ...message, userId: toUserId } : message,
      );
    });
  }

  /** The move `undoMove` would remove next, without removing it. */
  peekLastMove(roomId: string, userId: string): Move | null {
    const moves = this.rooms.get(roomId)?.usersMoves.get(userId);

    return moves?.length ? moves[moves.length - 1] : null;
  }

  /**
   * Returns the joined user, or null when the room does not exist or is full.
   * Rejoining with an id already in the room keeps the original colour, so a
   * user does not change colour by coming back.
   */
  join(
    roomId: string,
    userId: string,
    username: string,
    socketId: string,
  ): RoomUser | null {
    const room = this.rooms.get(roomId);

    if (!room) return null;

    const existing = room.users.get(userId);

    if (existing) {
      // Already known, possibly still inside their grace window. Cancel the
      // pending removal and take over the record rather than making a new one:
      // their colour, moves and undo history are all attached to it.
      if (existing.finalizeTimer) clearTimeout(existing.finalizeTimer);

      const rejoined: RoomUser = {
        ...existing,
        name: username,
        socketId,
        disconnectedAt: null,
        finalizeTimer: null,
      };

      room.users.set(userId, rejoined);
      room.emptySince = null;

      return rejoined;
    }

    // Synthetic members do not count: the AI teammate must never be the
    // reason a twelfth person is turned away.
    if (humanCount(room) >= MAX_ROOM_USERS) return null;

    const user: RoomUser = {
      userId,
      name: username,
      color: pickColor(room.users.values()),
      socketId,
      disconnectedAt: null,
      finalizeTimer: null,
      synthetic: false,
    };

    room.users.set(userId, user);
    if (!room.usersMoves.has(userId)) room.usersMoves.set(userId, []);
    room.emptySince = null;

    return user;
  }

  /**
   * Adds a server-driven member such as the AI teammate. It has no socket,
   * is exempt from the cap, and does not stop an empty room being swept.
   * Returns the existing record if it is already there.
   */
  addSyntheticUser(
    roomId: string,
    userId: string,
    name: string,
    color: string,
  ): RoomUser | null {
    const room = this.rooms.get(roomId);

    if (!room) return null;

    const existing = room.users.get(userId);
    if (existing) return existing;

    const user: RoomUser = {
      userId,
      name,
      color,
      socketId: null,
      disconnectedAt: null,
      finalizeTimer: null,
      synthetic: true,
    };

    room.users.set(userId, user);
    if (!room.usersMoves.has(userId)) room.usersMoves.set(userId, []);

    return user;
  }

  /**
   * Marks a user offline and starts their grace window. Their place in the room
   * is held until it expires: the same colour, the same moves, the same undo
   * history. Returns false when there was nothing to mark.
   *
   * This replaces removing the user the moment their socket dropped, which made
   * a tunnel or a Wi-Fi handover indistinguishable from leaving for good.
   */
  markOffline(roomId: string, userId: string, now = Date.now()): boolean {
    const room = this.rooms.get(roomId);
    const user = room?.users.get(userId);

    if (!room || !user || user.synthetic) return false;

    if (user.finalizeTimer) clearTimeout(user.finalizeTimer);

    const timer = setTimeout(() => {
      this.finalize(roomId, userId);
    }, this.options.userGraceMs);

    timer.unref?.();

    room.users.set(userId, {
      ...user,
      socketId: null,
      disconnectedAt: now,
      finalizeTimer: timer,
    });

    return true;
  }

  /**
   * The grace window expired: fold the user's moves into `drawed` and drop
   * them. Notifies through `onUserFinalized` so the room can be told without
   * this class knowing what a socket is.
   */
  private finalize(roomId: string, userId: string, now = Date.now()) {
    const room = this.rooms.get(roomId);

    if (!room || !room.users.has(userId)) return;

    this.leave(roomId, userId);

    if (humanCount(room) === 0 && room.emptySince === null) {
      room.emptySince = now;
    }

    this.options.onUserFinalized?.(roomId, userId);
  }

  /** True while the user holds a place in the room but has no live socket. */
  isOffline(roomId: string, userId: string): boolean {
    const user = this.rooms.get(roomId)?.users.get(userId);

    return Boolean(user && !user.synthetic && user.socketId === null);
  }

  /**
   * Every move in the room after `seq`, in order. This is what a reconnecting
   * client is sent instead of the whole board: it already has everything up to
   * the last sequence number it saw.
   */
  movesSince(roomId: string, seq: number): Move[] {
    const room = this.rooms.get(roomId);

    if (!room) return [];

    const moves = [...room.drawed];
    room.usersMoves.forEach((userMoves) => moves.push(...userMoves));

    return moves.filter((move) => move.seq > seq).sort((a, b) => a.seq - b.seq);
  }

  /** Moves after `seq`, grouped by author, plus those with no author left. */
  deltaSince(
    roomId: string,
    seq: number,
  ): { usersMoves: [string, Move[]][]; drawed: Move[] } {
    const room = this.rooms.get(roomId);

    if (!room) return { usersMoves: [], drawed: [] };

    const usersMoves: [string, Move[]][] = [];

    room.usersMoves.forEach((userMoves, userId) => {
      const missed = userMoves.filter((move) => move.seq > seq);

      if (missed.length) usersMoves.push([userId, missed]);
    });

    return {
      usersMoves,
      drawed: room.drawed.filter((move) => move.seq > seq),
    };
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

    const user = room.users.get(userId);
    if (user?.finalizeTimer) clearTimeout(user.finalizeTimer);

    room.users.delete(userId);

    // Start the clock on an empty room so the sweeper can reclaim it. Only
    // people count, and a clock already running is not restarted: the AI
    // teammate leaving an abandoned room must not extend its life.
    if (humanCount(room) === 0 && room.emptySince === null) {
      room.emptySince = Date.now();
    }

    return true;
  }

  /**
   * Stamps a validated payload with the fields only the server may set and
   * stores it. A `clientId` this room has already accepted is reported as a
   * duplicate rather than stored again, which is what makes a resend safe.
   *
   * `userId` is stamped here and never removed, including when the author
   * leaves and the move folds into `drawed`, so history can always be
   * filtered by person. `meta` is optional server bookkeeping (an AI request
   * id, for instance) that the client is not allowed to set.
   */
  addMove(
    roomId: string,
    userId: string,
    payload: DrawPayload,
    meta?: MoveMeta,
  ): AddMoveResult {
    const room = this.rooms.get(roomId);

    if (!room) return { status: 'no_room' };

    if (room.clientIds.has(payload.clientId)) return { status: 'duplicate' };

    room.seq += 1;

    const move: Move = {
      ...payload,
      id: v4(),
      timestamp: Date.now(),
      seq: room.seq,
      userId,
      ...(meta ? { meta } : {}),
    };

    const userMoves = room.usersMoves.get(userId);

    if (userMoves) userMoves.push(move);
    else room.usersMoves.set(userId, [move]);

    room.clientIds.add(payload.clientId);

    return { status: 'stored', move };
  }

  /**
   * Removes the named moves from wherever they live — any author's list or
   * `drawed` — and returns the ones that were found. Ids that match nothing
   * are ignored, so a stale request cannot fail loudly or touch anything else.
   *
   * The removed moves' client ids are released so a later move that happens
   * to reuse one (a redo, say) is not mistaken for a duplicate.
   */
  removeMoves(roomId: string, ids: string[]): Move[] {
    const room = this.rooms.get(roomId);

    if (!room || !ids.length) return [];

    const wanted = new Set(ids);
    const removed: Move[] = [];

    const take = (moves: Move[]): Move[] =>
      moves.filter((move) => {
        if (!wanted.has(move.id)) return true;

        removed.push(move);
        room.clientIds.delete(move.clientId);

        return false;
      });

    room.usersMoves.forEach((moves, userId) => {
      room.usersMoves.set(userId, take(moves));
    });

    room.drawed = take(room.drawed);

    return removed;
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
