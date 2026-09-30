import { desc, eq } from 'drizzle-orm';
import { v4 } from 'uuid';

import { CANVAS_SIZE } from '@/common/constants/canvasSize';

import { JobQueue } from '../ai/queue';
import type { BoardStore } from '../boards/BoardStore';
import type { Database } from '../db/client';
import { boards as boardsTable, boardSnapshots } from '../db/schema';
import { logger } from '../logger';
import { createNodeImageLoader } from '../render/nodeLoader';
import { encodePng, encodeWebp, renderBoard } from '../render/renderBoard';
import type { ObjectStorage } from '../storage';

export type SnapshotOptions = {
  /** Moves since the last snapshot that trigger the next one. */
  snapshotEvery: number;
  /** Quiet time after the last change before the thumbnail re-renders. */
  thumbnailDebounceMs: number;
  /** Snapshots kept per board; older ones and their objects are deleted. */
  keepSnapshots: number;
};

export const DEFAULT_SNAPSHOTS: SnapshotOptions = {
  snapshotEvery: 500,
  thumbnailDebounceMs: 60_000,
  keepSnapshots: 3,
};

/** 480 px wide, like the dashboard card that shows it. */
const THUMBNAIL_SCALE = 480 / CANVAS_SIZE.width;

/**
 * Background rendering for persisted boards. A snapshot compacts everything
 * up to a sequence number into one PNG so a cold board loads as one image
 * plus a tail; a thumbnail is a small WebP for the dashboard. Both use the
 * browser's own `drawMove` on a Node canvas. One job at a time: rendering a
 * 4000 by 2000 board is CPU work, and nothing here is urgent.
 */
export class SnapshotService {
  private queue = new JobQueue({ concurrency: 1, maxLength: 200, timeoutMs: 120_000 });

  private pendingMoves = new Map<string, number>();

  private thumbnailTimers = new Map<string, NodeJS.Timeout>();

  private options: SnapshotOptions;

  private loader: ReturnType<typeof createNodeImageLoader>;

  constructor(
    private boards: BoardStore,
    private database: Database,
    private storage: ObjectStorage,
    options: Partial<SnapshotOptions> = {},
  ) {
    this.options = { ...DEFAULT_SNAPSHOTS, ...options };
    this.loader = createNodeImageLoader(storage);
  }

  /** Something changed on the board: count toward a snapshot, debounce a thumbnail. */
  noteActivity(roomId: string) {
    const room = this.boards.get(roomId);
    if (!room) return;

    // First sight of a room: count what is already there (the move that
    // triggered this call included). Afterwards, one per call.
    const previous = this.pendingMoves.get(roomId);
    const count = previous === undefined ? this.movesSinceSnapshot(roomId) : previous + 1;

    if (count >= this.options.snapshotEvery) {
      this.pendingMoves.set(roomId, 0);
      this.enqueueSnapshot(roomId);
    } else {
      this.pendingMoves.set(roomId, count);
    }

    const existing = this.thumbnailTimers.get(roomId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.thumbnailTimers.delete(roomId);
      this.enqueueThumbnail(roomId);
    }, this.options.thumbnailDebounceMs);
    timer.unref?.();

    this.thumbnailTimers.set(roomId, timer);
  }

  enqueueSnapshot(roomId: string) {
    this.queue.enqueue({
      id: `snapshot:${roomId}:${Date.now()}`,
      run: () => this.snapshot(roomId),
    });
  }

  enqueueThumbnail(roomId: string) {
    this.queue.enqueue({
      id: `thumbnail:${roomId}:${Date.now()}`,
      run: () => this.thumbnail(roomId),
    });
  }

  /** Waits for every queued job to finish. Tests and shutdown use it. */
  async drain(timeoutMs = 30_000) {
    const started = Date.now();

    while (this.queue.size > 0 && Date.now() - started < timeoutMs) {
      // eslint-disable-next-line no-await-in-loop -- polling a queue is the point
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    }
  }

  stop() {
    this.thumbnailTimers.forEach((timer) => clearTimeout(timer));
    this.thumbnailTimers.clear();
    this.queue.stop();
  }

  private movesSinceSnapshot(roomId: string) {
    const room = this.boards.get(roomId);
    if (!room) return 0;

    return this.boards.movesSince(roomId, room.snapshotSeq).length;
  }

  /** Renders everything on the board (including an earlier snapshot image) to one PNG. */
  async snapshot(roomId: string) {
    const room = this.boards.get(roomId);
    if (!room) return;

    const { seq } = room;
    const moves = this.boards.movesSince(roomId, 0);

    if (!moves.length || seq <= room.snapshotSeq) return;

    const startedAt = Date.now();

    try {
      const canvas = await renderBoard(moves, { loader: this.loader, background: null });
      const png = await encodePng(canvas);
      const key = `boards/${roomId}/snapshots/${seq}.png`;

      await this.storage.put(key, png, 'image/png');
      await this.database.db.insert(boardSnapshots).values({
        id: v4(),
        boardId: roomId,
        seq,
        imageKey: key,
        width: canvas.width,
        height: canvas.height,
      });

      // The in-memory room keeps every move; the snapshot only shortens
      // cold loads. Record which sequence it covers.
      room.snapshotSeq = Math.max(room.snapshotSeq, seq);

      await this.pruneSnapshots(roomId);

      logger.info(
        { roomId, seq, bytes: png.length, ms: Date.now() - startedAt },
        'snapshot rendered',
      );
    } catch (error) {
      logger.error({ err: error, roomId }, 'snapshot failed');
    }
  }

  async thumbnail(roomId: string) {
    const room = this.boards.get(roomId);
    if (!room) return;

    const moves = this.boards.movesSince(roomId, 0);

    try {
      const canvas = await renderBoard(moves, {
        loader: this.loader,
        scale: THUMBNAIL_SCALE,
        background: { mode: 'light', lines: true },
      });
      const webp = await encodeWebp(canvas, 80);
      const key = `boards/${roomId}/thumb.webp`;

      await this.storage.put(key, webp, 'image/webp');
      await this.database.db
        .update(boardsTable)
        .set({ thumbnailKey: key, updatedAt: new Date() })
        .where(eq(boardsTable.id, roomId));

      logger.debug({ roomId, bytes: webp.length }, 'thumbnail rendered');
    } catch (error) {
      logger.error({ err: error, roomId }, 'thumbnail failed');
    }
  }

  private async pruneSnapshots(roomId: string) {
    const rows = await this.database.db
      .select({ id: boardSnapshots.id, imageKey: boardSnapshots.imageKey })
      .from(boardSnapshots)
      .where(eq(boardSnapshots.boardId, roomId))
      .orderBy(desc(boardSnapshots.seq));

    const stale = rows.slice(this.options.keepSnapshots);

    if (!stale.length) return;

    await Promise.all(
      stale.map((row) => this.database.db.delete(boardSnapshots).where(eq(boardSnapshots.id, row.id))),
    );
    await this.storage.delete(stale.map((row) => row.imageKey));
  }
}
