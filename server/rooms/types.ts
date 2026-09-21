import type { Move, User } from '@/common/types/global';

/**
 * A room member. Keyed by the stable `userId` from the handshake, not by
 * `socket.id`, so a reconnect rejoins the same person rather than creating a
 * new one.
 *
 * `color` lives here because the server assigns it. It used to be computed on
 * each client from the order users happened to arrive in, so two people could
 * see the same third person in different colours.
 */
export type RoomUser = User & {
  userId: string;
  /**
   * The connection currently representing this user, or null while they are
   * offline. A user with no socket still holds their place in the room until
   * the grace window expires.
   */
  socketId: string | null;
  /** When the socket dropped, or null while connected. */
  disconnectedAt: number | null;
  /**
   * Pending finalize for this user. Held on the record so that rejoining can
   * cancel it, and so deleting a room can clear it — an orphaned timer would
   * fire against state that no longer exists.
   */
  finalizeTimer: NodeJS.Timeout | null;
};

export type ServerRoom = {
  /** Keyed by userId. Includes users who are offline but still in grace. */
  users: Map<string, RoomUser>;
  /** Keyed by userId. */
  usersMoves: Map<string, Move[]>;
  /** Moves belonging to users who have left for good, so the drawing stays. */
  drawed: Move[];
  /** Last sequence number handed out in this room. */
  seq: number;
  /**
   * Every `clientId` this room has accepted. A resent move is recognised
   * instead of being drawn a second time, which is what makes a retry safe.
   */
  clientIds: Set<string>;
  /**
   * When the room last became empty, or null while anyone is still in it.
   * Empty rooms used to live until the process restarted.
   */
  emptySince: number | null;
};

/**
 * Strips a room user down to what clients are allowed to see.
 *
 * `RoomUser` carries server bookkeeping — the current socket, the disconnect
 * timestamp, a pending timer handle — none of which belongs on the wire. The
 * timer in particular is a live object that JSON would mangle into nonsense.
 * `offline` is derived here so clients do not have to infer presence.
 */
export const toPublicUser = (user: RoomUser): User => ({
  name: user.name,
  color: user.color,
  offline: user.socketId === null,
});

/** The user list as clients receive it: `[userId, publicUser]` pairs. */
export const toPublicUsers = (
  users: Map<string, RoomUser>,
): [string, User][] =>
  [...users].map(([userId, user]) => [userId, toPublicUser(user)]);
