import { and, desc, eq, gt, inArray, isNull, max } from 'drizzle-orm';
import { v4 } from 'uuid';

import type { ChatMessage, Move } from '@/common/types/global';

import type { Database, Db } from '../db/client';
import {
  boardMembers,
  boardMoves,
  boardOps,
  boards,
  boardSnapshots,
  chatMessages,
  toChatMessage,
  users,
} from '../db/schema';
import { logger } from '../logger';
import { persistenceBatchesDropped } from '../ops/metrics';
import { type HydratedRoom, MAX_CHAT_HISTORY } from '../rooms/RoomStore';
import type { ObjectStorage } from '../storage';
import type { Persistence } from './persistence';

type Pending =
  | { kind: 'move'; roomId: string; move: Move }
  | { kind: 'remove'; roomId: string; moveIds: string[]; reason: 'undo' | 'remove' }
  | { kind: 'rename'; roomId: string; title: string }
  | { kind: 'chat'; roomId: string; message: ChatMessage };

export type DbPersistenceOptions = {
  /** Buffered writes go to the database at least this often. */
  flushMs: number;
  /** Or as soon as this many are waiting. */
  flushSize: number;
  /** A failed batch is retried this many times before it is dropped. */
  maxRetries: number;
  /** Resolves snapshot keys to URLs. Without it, snapshots are not used on load. */
  storage?: ObjectStorage;
};

export const DEFAULT_DB_PERSISTENCE: DbPersistenceOptions = {
  flushMs: 50,
  flushSize: 50,
  maxRetries: 3,
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * The Postgres implementation of the durability port. Reads rebuild a room
 * from `boards`, `board_moves` and `chat_messages`; writes are buffered and
 * applied in order inside one transaction per flush, so a move and its undo
 * in the same batch land in the right sequence. Every mutation is also
 * appended to `board_ops`, the history Rewind will read across restarts.
 *
 * Runs unchanged on hosted Postgres and on the embedded engine.
 */
export class DbPersistence implements Persistence {
  readonly kind: Database['kind'];

  private db: Db;

  private options: DbPersistenceOptions;

  private pending: Pending[] = [];

  private timer: NodeJS.Timeout | null = null;

  private flushing: Promise<void> | null = null;

  private closed = false;

  constructor(
    private database: Database,
    options: Partial<DbPersistenceOptions> = {},
  ) {
    this.db = database.db;
    this.kind = database.kind;
    this.options = { ...DEFAULT_DB_PERSISTENCE, ...options };
  }

  async loadRoom(roomId: string): Promise<HydratedRoom | null> {
    const [board] = await this.db
      .select()
      .from(boards)
      .where(and(eq(boards.id, roomId), isNull(boards.deletedAt)));

    if (!board) return null;

    // With a snapshot, only the tail after it is loaded: the picture stands
    // in for everything before, which is the point of rendering it.
    const [latest] = this.options.storage
      ? await this.db
          .select()
          .from(boardSnapshots)
          .where(eq(boardSnapshots.boardId, roomId))
          .orderBy(desc(boardSnapshots.seq))
          .limit(1)
      : [];

    const snapshot =
      latest && this.options.storage
        ? {
            url: this.options.storage.publicUrl(latest.imageKey),
            seq: Number(latest.seq),
            width: latest.width,
            height: latest.height,
          }
        : null;

    const moveRows = await this.db
      .select({ payload: boardMoves.payload })
      .from(boardMoves)
      .where(
        snapshot
          ? and(eq(boardMoves.boardId, roomId), gt(boardMoves.seq, snapshot.seq))
          : eq(boardMoves.boardId, roomId),
      )
      .orderBy(boardMoves.seq);

    const chatRows = await this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.boardId, roomId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(MAX_CHAT_HISTORY);

    // The highest sequence ever handed out, undone moves included, so a
    // move drawn after a restart never reuses a number Rewind has seen.
    const [{ highest }] = await this.db
      .select({ highest: max(boardOps.seq) })
      .from(boardOps)
      .where(eq(boardOps.boardId, roomId));

    return {
      title: board.title,
      ownerId: board.ownerId,
      seq: Number(highest ?? 0),
      moves: moveRows.map((row) => row.payload),
      chat: chatRows.reverse().map(toChatMessage),
      snapshot,
    };
  }

  async createRoom(
    roomId: string,
    room: { title: string; ownerId: string | null; ownerName: string },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (room.ownerId) {
        // A guest becomes a row the moment they own something.
        await tx
          .insert(users)
          .values({ id: room.ownerId, name: room.ownerName, isGuest: true })
          .onConflictDoNothing();
      }

      await tx
        .insert(boards)
        .values({ id: roomId, title: room.title, ownerId: room.ownerId })
        .onConflictDoNothing();

      if (room.ownerId) {
        await tx
          .insert(boardMembers)
          .values({ boardId: roomId, userId: room.ownerId, role: 'owner' })
          .onConflictDoNothing();
      }
    });
  }

  appendMove(roomId: string, move: Move) {
    this.enqueue({ kind: 'move', roomId, move });
  }

  removeMoves(roomId: string, moveIds: string[], reason: 'undo' | 'remove') {
    if (moveIds.length) this.enqueue({ kind: 'remove', roomId, moveIds, reason });
  }

  renameRoom(roomId: string, title: string) {
    this.enqueue({ kind: 'rename', roomId, title });
  }

  appendChat(roomId: string, message: ChatMessage) {
    this.enqueue({ kind: 'chat', roomId, message });
  }

  /** Writes everything waiting, including anything enqueued while writing. */
  async flush(): Promise<void> {
    if (this.flushing) await this.flushing;

    if (!this.pending.length) return;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const batch = this.pending;
    this.pending = [];

    this.flushing = this.write(batch).finally(() => {
      this.flushing = null;
    });

    await this.flushing;

    if (this.pending.length) await this.flush();
  }

  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
    await this.database.close();
  }

  private enqueue(item: Pending) {
    if (this.closed) return;

    this.pending.push(item);

    if (this.pending.length >= this.options.flushSize) {
      this.flush().catch(() => {});
      return;
    }

    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush().catch(() => {});
      }, this.options.flushMs);
      this.timer.unref?.();
    }
  }

  /**
   * One transaction for the whole batch, in order. Consecutive moves become
   * one multi-row insert; everything else is a statement of its own.
   */
  private async write(batch: Pending[], attempt = 0): Promise<void> {
    const steps: ((tx: Parameters<Parameters<Db['transaction']>[0]>[0]) => Promise<unknown>)[] = [];
    const touched = new Set<string>();

    let i = 0;

    while (i < batch.length) {
      const item = batch[i];

      if (item.kind === 'move') {
        const group: Extract<Pending, { kind: 'move' }>[] = [];

        while (i < batch.length && batch[i].kind === 'move') {
          group.push(batch[i] as Extract<Pending, { kind: 'move' }>);
          i += 1;
        }

        group.forEach((entry) => touched.add(entry.roomId));

        steps.push((tx) =>
          tx
            .insert(boardMoves)
            .values(
              group.map(({ roomId, move }) => ({
                moveId: move.id,
                boardId: roomId,
                seq: move.seq,
                userId: move.userId,
                clientId: move.clientId,
                payload: move,
              })),
            )
            .onConflictDoNothing(),
        );
        steps.push((tx) =>
          tx.insert(boardOps).values(
            group.map(({ roomId, move }) => ({
              id: v4(),
              boardId: roomId,
              seq: move.seq,
              kind: 'move',
              moveId: move.id,
              userId: move.userId,
              payload: move,
            })),
          ),
        );
      } else if (item.kind === 'remove') {
        const { roomId, moveIds, reason } = item;

        touched.add(roomId);
        steps.push((tx) => tx.delete(boardMoves).where(inArray(boardMoves.moveId, moveIds)));
        steps.push((tx) =>
          tx.insert(boardOps).values(
            moveIds.map((moveId) => ({
              id: v4(),
              boardId: roomId,
              seq: null,
              kind: reason,
              moveId,
              userId: null,
              payload: null,
            })),
          ),
        );
        i += 1;
      } else if (item.kind === 'rename') {
        const { roomId, title } = item;

        steps.push((tx) =>
          tx.update(boards).set({ title, updatedAt: new Date() }).where(eq(boards.id, roomId)),
        );
        i += 1;
      } else {
        const { roomId, message } = item;

        touched.add(roomId);
        steps.push((tx) =>
          tx
            .insert(chatMessages)
            .values({
              id: message.id,
              boardId: roomId,
              userId: message.userId,
              name: message.name,
              body: message.body,
              createdAt: new Date(message.createdAt),
            })
            .onConflictDoNothing(),
        );
        i += 1;
      }
    }

    touched.forEach((roomId) => {
      steps.push((tx) =>
        tx.update(boards).set({ lastActivityAt: new Date() }).where(eq(boards.id, roomId)),
      );
    });

    try {
      await this.db.transaction(async (tx) => {
        await steps.reduce<Promise<unknown>>(
          (previous, step) => previous.then(() => step(tx)),
          Promise.resolve(),
        );
      });
    } catch (error) {
      if (attempt < this.options.maxRetries) {
        logger.warn(
          { err: error, attempt, size: batch.length },
          'persistence batch failed, retrying',
        );

        await sleep(50 * 2 ** attempt);
        await this.write(batch, attempt + 1);
        return;
      }

      // The room still has everything in memory; only the record is behind.
      persistenceBatchesDropped.inc();
      logger.error({ err: error, dropped: batch.length }, 'persistence batch dropped');
    }
  }
}
