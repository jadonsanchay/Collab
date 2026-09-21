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
export type RoomUser = User & { userId: string };

export type ServerRoom = {
  /** Keyed by userId. */
  users: Map<string, RoomUser>;
  /** Keyed by userId. */
  usersMoves: Map<string, Move[]>;
  /** Moves belonging to users who have left, kept so the drawing survives. */
  drawed: Move[];
  /** Last sequence number handed out in this room. */
  seq: number;
  /**
   * Every `clientId` this room has accepted. A resent move is recognised
   * instead of being drawn a second time, which is what makes a retry safe.
   */
  clientIds: Set<string>;
};
