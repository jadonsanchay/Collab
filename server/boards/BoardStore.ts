import type {
  ChatMessage,
  DrawPayload,
  Move,
  MoveMeta,
} from '@/common/types/global';

import { logger } from '../logger';
import type { AddMoveResult, RoomStore } from '../rooms/RoomStore';
import type { RoomUser, ServerRoom } from '../rooms/types';
import type { Persistence } from './persistence';

/**
 * What the handlers and the AI teammate talk to. It is the in-memory
 * `RoomStore` plus, when a persistence layer is configured, durability:
 * every accepted mutation is recorded, and a room that is not in memory is
 * rebuilt from the record before it is joined.
 *
 * Without persistence it behaves exactly like the Phase 2 store, which is
 * what `STORAGE=memory` promises. The room logic itself lives in
 * `RoomStore`; this class only decides what to remember.
 */
export type BoardStoreOptions = {
  /**
   * Called after any change to a room's drawing. Feeds the snapshot and
   * thumbnail jobs, which is why it is a plain callback rather than a
   * dependency: the store does not need to know what rendering is.
   */
  onActivity?: (roomId: string) => void;
};

export class BoardStore {
  private loading = new Map<string, Promise<boolean>>();

  constructor(
    readonly rooms: RoomStore,
    private persistence: Persistence | null = null,
    private options: BoardStoreOptions = {},
  ) {}

  get persistent(): boolean {
    return this.persistence !== null;
  }

  get storageKind(): string {
    return this.persistence?.kind ?? 'memory';
  }

  /**
   * True when the room is in memory, or could be brought there. Concurrent
   * callers for the same room share one load, so two people joining a cold
   * board at once do not hydrate it twice.
   */
  async ensureLoaded(roomId: string): Promise<boolean> {
    if (this.rooms.has(roomId)) return true;
    if (!this.persistence) return false;

    const pending = this.loading.get(roomId);
    if (pending) return pending;

    const load = this.persistence
      .loadRoom(roomId)
      .then((data) => {
        if (!data) return false;

        // Someone may have created it in memory meanwhile; hydrate is a no-op then.
        this.rooms.hydrate(roomId, data);

        return true;
      })
      .catch((error) => {
        logger.error({ err: error, roomId }, 'failed to load a room');

        return false;
      })
      .finally(() => {
        this.loading.delete(roomId);
      });

    this.loading.set(roomId, load);

    return load;
  }

  has(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  get(roomId: string): ServerRoom | undefined {
    return this.rooms.get(roomId);
  }

  async create(
    userId: string,
    username: string,
    socketId: string,
    title?: string,
  ): Promise<{ roomId: string; user: RoomUser }> {
    const created = this.rooms.create(userId, username, socketId, { title });

    if (this.persistence) {
      const room = this.rooms.get(created.roomId);

      try {
        await this.persistence.createRoom(created.roomId, {
          title: room?.title ?? title ?? '',
          ownerId: userId,
          ownerName: username,
        });
      } catch (error) {
        // The room still works for this session; it just will not survive a
        // restart. Better than refusing to create it.
        logger.error({ err: error, roomId: created.roomId }, 'failed to persist a new room');
      }
    }

    return created;
  }

  /**
   * A board created over HTTP (the dashboard): the owner is a member with no
   * socket yet, held in the grace window so their first visit rejoins rather
   * than joins. The owner's colour and place are theirs when they arrive.
   */
  async createDetached(ownerId: string, ownerName: string, title?: string): Promise<string> {
    const { roomId } = await this.create(ownerId, ownerName, '', title);

    this.rooms.markOffline(roomId, ownerId);

    return roomId;
  }

  join(roomId: string, userId: string, username: string, socketId: string): RoomUser | null {
    return this.rooms.join(roomId, userId, username, socketId);
  }

  addSyntheticUser(roomId: string, userId: string, name: string, color: string) {
    return this.rooms.addSyntheticUser(roomId, userId, name, color);
  }

  markOffline(roomId: string, userId: string): boolean {
    return this.rooms.markOffline(roomId, userId);
  }

  isOffline(roomId: string, userId: string): boolean {
    return this.rooms.isOffline(roomId, userId);
  }

  leave(roomId: string, userId: string): boolean {
    return this.rooms.leave(roomId, userId);
  }

  movesSince(roomId: string, seq: number): Move[] {
    return this.rooms.movesSince(roomId, seq);
  }

  deltaSince(roomId: string, seq: number) {
    return this.rooms.deltaSince(roomId, seq);
  }

  addMove(roomId: string, userId: string, payload: DrawPayload, meta?: MoveMeta): AddMoveResult {
    const result = this.rooms.addMove(roomId, userId, payload, meta);

    if (result.status === 'stored') {
      this.persistence?.appendMove(roomId, result.move);
      this.options.onActivity?.(roomId);
    }

    return result;
  }

  undoMove(roomId: string, userId: string): boolean {
    // Peek first: RoomStore reports only whether the list existed, and the
    // record needs to know which move went away.
    const last = this.rooms.peekLastMove(roomId, userId);
    const ok = this.rooms.undoMove(roomId, userId);

    if (ok && last) {
      this.persistence?.removeMoves(roomId, [last.id], 'undo');
      this.options.onActivity?.(roomId);
    }

    return ok;
  }

  removeMoves(roomId: string, ids: string[]): Move[] {
    const removed = this.rooms.removeMoves(roomId, ids);

    if (removed.length) {
      this.persistence?.removeMoves(
        roomId,
        removed.map((move) => move.id),
        'remove',
      );
      this.options.onActivity?.(roomId);
    }

    return removed;
  }

  rename(roomId: string, title: string): boolean {
    const ok = this.rooms.rename(roomId, title);

    if (ok) {
      const room = this.rooms.get(roomId);
      if (room) this.persistence?.renameRoom(roomId, room.title);
    }

    return ok;
  }

  appendChat(roomId: string, message: ChatMessage): boolean {
    const ok = this.rooms.appendChat(roomId, message);

    if (ok) this.persistence?.appendChat(roomId, message);

    return ok;
  }

  async flush() {
    await this.persistence?.flush();
  }

  async stop() {
    this.rooms.stop();
    await this.persistence?.flush();
    await this.persistence?.close();
  }
}
