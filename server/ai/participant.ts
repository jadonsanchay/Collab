import type { Server } from 'socket.io';

import { AI_USER_COLOR, AI_USER_ID, AI_USER_NAME } from '@/common/constants/ai';
import type {
  ClientToServerEvents,
  CtxOptions,
  Move,
  Point,
  ServerToClientEvents,
} from '@/common/types/global';
import type { BoardObject } from '@/common/vector/types';

import type { BoardStore } from '../boards/BoardStore';
import type { SocketData } from '../socket/identity';
import type { PlannedMove } from './interpreter';
import type { PlannedObject } from './toObjects';

type IOServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export type ParticipantOptions = {
  /** Without a request for this long, Sketch leaves the room. */
  idleLeaveMs: number;
  /** Cursor update interval while drawing. 33 ms matches the human budget. */
  tickMs: number;
};

export const DEFAULT_PARTICIPANT: ParticipantOptions = {
  idleLeaveMs: 10 * 60_000,
  tickMs: 33,
};

/** A pen path to trace, optionally streamed to raster clients as a live stroke. */
type TraceItem = {
  cursorPath: Point[];
  durationMs: number;
  liveStroke?: { strokeId: string; options: CtxOptions };
};

/** Cumulative distance to each vertex, for walking a path by fraction. */
const cumulative = (path: Point[]) => {
  const distances = [0];

  for (let i = 1; i < path.length; i += 1) {
    const [px, py] = path[i - 1];
    const [x, y] = path[i];

    distances.push(distances[i - 1] + Math.hypot(x - px, y - py));
  }

  return distances;
};

const pointAt = (path: Point[], distances: number[], distance: number): Point => {
  if (path.length === 1) return path[0];

  const total = distances[distances.length - 1];

  if (total === 0) return path[path.length - 1];

  const target = Math.min(distance, total);
  let index = 1;

  while (index < distances.length - 1 && distances[index] < target) index += 1;

  const segment = distances[index] - distances[index - 1];
  const t = segment === 0 ? 1 : (target - distances[index - 1]) / segment;
  const [ax, ay] = path[index - 1];
  const [bx, by] = path[index];

  return [ax + (bx - ax) * t, ay + (by - ay) * t];
};

/**
 * The synthetic room member. Sketch speaks the same protocol as a human —
 * `new_user`, `cursor_moved`, `live_stroke_*`, `user_draw`, `new_msg`,
 * `user_disconnected` — so clients render it without knowing it is not one.
 *
 * Nothing here busy-waits: the animation is a chain of timers, and every
 * step checks the abort signal so "Undo Sketch" mid-drawing stops the pen.
 */
export class SketchParticipant {
  private idleTimers = new Map<string, NodeJS.Timeout>();

  private options: ParticipantOptions;

  constructor(
    private io: IOServer,
    private rooms: BoardStore,
    options: Partial<ParticipantOptions> = {},
  ) {
    this.options = { ...DEFAULT_PARTICIPANT, ...options };
  }

  /** Adds Sketch to the room if it is not there yet. False when the room is gone. */
  ensure(roomId: string): boolean {
    const room = this.rooms.get(roomId);

    if (!room) return false;

    if (!room.users.has(AI_USER_ID)) {
      const user = this.rooms.addSyntheticUser(
        roomId,
        AI_USER_ID,
        AI_USER_NAME,
        AI_USER_COLOR,
      );

      if (!user) return false;

      this.io.to(roomId).emit('new_user', AI_USER_ID, user.name, user.color);
    }

    this.touch(roomId);

    return true;
  }

  isPresent(roomId: string): boolean {
    return Boolean(this.rooms.get(roomId)?.users.has(AI_USER_ID));
  }

  /** Restarts the idle clock. */
  touch(roomId: string) {
    const existing = this.idleTimers.get(roomId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => this.leave(roomId), this.options.idleLeaveMs);
    timer.unref?.();

    this.idleTimers.set(roomId, timer);
  }

  leave(roomId: string) {
    const timer = this.idleTimers.get(roomId);
    if (timer) clearTimeout(timer);
    this.idleTimers.delete(roomId);

    if (!this.isPresent(roomId)) return;

    // Folds Sketch's moves into `drawed` like any departed user's.
    if (this.rooms.leave(roomId, AI_USER_ID)) {
      this.io.to(roomId).emit('user_disconnected', AI_USER_ID);
    }
  }

  say(roomId: string, text: string) {
    this.io.to(roomId).emit('new_msg', AI_USER_ID, text);
  }

  moveCursor(roomId: string, [x, y]: Point) {
    this.io.to(roomId).volatile.emit('cursor_moved', AI_USER_ID, x, y);
  }

  /**
   * Draws the planned moves one after another: cursor along the pen path
   * (streaming a live stroke for lines), then the committed move. Returns
   * the moves that were stored. Stops early on abort or if Sketch or the
   * room is gone.
   */
  async animate(
    roomId: string,
    requestId: string,
    planned: PlannedMove[],
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Move[]> {
    const stored: Move[] = [];

    this.touch(roomId);

    await planned.reduce(async (previous, item, index) => {
      await previous;

      if (signal.aborted || !this.isPresent(roomId)) return;

      const liveStroke =
        item.payload.options.shape === 'line'
          ? { strokeId: item.payload.clientId, options: item.payload.options }
          : undefined;

      await this.trace(roomId, { cursorPath: item.cursorPath, durationMs: item.durationMs, liveStroke }, signal);

      if (signal.aborted || !this.isPresent(roomId)) return;

      const result = this.rooms.addMove(roomId, AI_USER_ID, item.payload, {
        requestId,
      });

      if (result.status === 'stored') {
        stored.push(result.move);
        this.io.to(roomId).emit('user_draw', result.move, AI_USER_ID);
      }

      onProgress?.(index + 1, planned.length);
    }, Promise.resolve());

    return stored;
  }

  /**
   * The objects-board counterpart of `animate`: the cursor traces each
   * object's outline, then `write` puts the object in the document (the sync
   * server carries it to every window). Returns the objects written.
   */
  async animateObjects(
    roomId: string,
    planned: PlannedObject[],
    signal: AbortSignal,
    write: (object: BoardObject) => void,
    onProgress?: (done: number, total: number) => void,
  ): Promise<BoardObject[]> {
    const written: BoardObject[] = [];

    this.touch(roomId);

    await planned.reduce(async (previous, item, index) => {
      await previous;

      if (signal.aborted || !this.isPresent(roomId)) return;

      await this.trace(roomId, { cursorPath: item.cursorPath, durationMs: item.durationMs }, signal);

      if (signal.aborted || !this.isPresent(roomId)) return;

      write(item.object);
      written.push(item.object);

      onProgress?.(index + 1, planned.length);
    }, Promise.resolve());

    return written;
  }

  stop() {
    this.idleTimers.forEach((timer) => clearTimeout(timer));
    this.idleTimers.clear();
  }

  /** Walks the cursor along a path over its duration. */
  private trace(roomId: string, item: TraceItem, signal: AbortSignal) {
    const { cursorPath, durationMs, liveStroke } = item;
    const { tickMs } = this.options;

    if (!cursorPath.length) return Promise.resolve();

    const steps = Math.max(1, Math.round(durationMs / tickMs));
    const distances = cumulative(cursorPath);
    const total = distances[distances.length - 1];

    // The live stroke is not volatile, unlike a human's: a volatile packet
    // is dropped whenever the previous write has not flushed yet, and these
    // are emitted in the same tick as a cursor update or a committed move,
    // so they would be dropped almost every time. They are one packet per
    // tick, so reliability is affordable here.
    if (liveStroke) {
      this.io
        .to(roomId)
        .emit(
          'live_stroke_start',
          AI_USER_ID,
          liveStroke.strokeId,
          liveStroke.options,
          cursorPath[0],
        );
    }

    return new Promise<void>((resolve) => {
      let step = 0;
      let lastDistance = 0;

      const finish = () => {
        if (liveStroke) {
          this.io.to(roomId).emit('live_stroke_end', AI_USER_ID, liveStroke.strokeId);
        }

        resolve();
      };

      const tick = () => {
        if (signal.aborted) {
          finish();
          return;
        }

        step += 1;

        const fraction = Math.min(1, step / steps);
        const distance = total * fraction;
        const point = pointAt(cursorPath, distances, distance);

        this.moveCursor(roomId, point);

        if (liveStroke) {
          // Every vertex passed since the last tick, then the pen position,
          // so corners are not cut between two updates.
          const passed = cursorPath.filter(
            (_, i) => i > 0 && distances[i] > lastDistance && distances[i] <= distance,
          );

          this.io
            .to(roomId)
            .emit('live_stroke_points', AI_USER_ID, liveStroke.strokeId, [...passed, point]);

          lastDistance = distance;
        }

        if (fraction >= 1) {
          finish();
          return;
        }

        setTimeout(tick, tickMs);
      };

      setTimeout(tick, tickMs);
    });
  }
}
