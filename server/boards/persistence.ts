import type { BoardEngine, ChatMessage, Move } from '@/common/types/global';

import type { HydratedRoom } from '../rooms/RoomStore';

/**
 * The durability port behind `BoardStore`. The in-memory `RoomStore` stays
 * the source of truth for every live room; an implementation of this makes
 * rooms survive a restart by recording what happened and rebuilding a room
 * on demand.
 *
 * Mutations are fire-and-forget from the store's point of view: an
 * implementation buffers, retries and logs, and never throws into a socket
 * handler. Only `loadRoom` and `createRoom` are awaited, because the caller
 * cannot proceed without their answer.
 */
export interface Persistence {
  readonly kind: string;
  /** Everything needed to rebuild a room, or null when it never existed. */
  loadRoom(roomId: string): Promise<HydratedRoom | null>;
  createRoom(
    roomId: string,
    room: { title: string; ownerId: string | null; ownerName: string; engine: BoardEngine },
  ): Promise<void>;
  appendMove(roomId: string, move: Move): void;
  removeMoves(roomId: string, moveIds: string[], reason: 'undo' | 'remove'): void;
  renameRoom(roomId: string, title: string): void;
  /** The board was converted to another engine (Phase 4's upgrade). */
  setEngine(roomId: string, engine: BoardEngine): void;
  appendChat(roomId: string, message: ChatMessage): void;
  /** Writes everything buffered. Tests and shutdown call it. */
  flush(): Promise<void>;
  close(): Promise<void>;
}
