import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMove } from '@/server/testing/fixtures';
import type { Move } from '@/common/types/global';

import { CommittedRenderer } from './CommittedRenderer';

/**
 * jsdom/node don't implement `createImageBitmap` or real canvas rendering,
 * so this exercises the renderer's checkpoint-vs-full-replay *decision*
 * against a fake `draw` that just logs the move ids it was asked to render,
 * rather than comparing real pixel buffers. The `drawnLog` for a run is the
 * proxy for "what pixels ended up on screen".
 */
const makeFakeCtx = () =>
  ({
    canvas: { width: 100, height: 100 },
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  }) as unknown as CanvasRenderingContext2D;

const makeMoves = (count: number): Move[] =>
  Array.from({ length: count }, (_, i) => makeMove({ id: `move-${i}`, seq: i }));

describe('CommittedRenderer', () => {
  let drawnLog: string[];
  let snapshotCount: number;
  let renderer: CommittedRenderer;
  let waitForRender: () => Promise<void>;

  beforeEach(() => {
    // Run rAF callbacks synchronously so `schedule` resolves within the test
    // without a real animation frame.
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      cb();
      return 0;
    });

    drawnLog = [];
    snapshotCount = 0;

    let resolveRender: (() => void) | null = null;
    waitForRender = () =>
      new Promise<void>((resolve) => {
        resolveRender = resolve;
      });

    const fakeDraw = (_ctx: CanvasRenderingContext2D, move: Move) => {
      drawnLog.push(move.id);
    };

    const fakeSnapshot = async () => {
      snapshotCount += 1;

      return { id: snapshotCount } as unknown as ImageBitmap;
    };

    renderer = new CommittedRenderer(
      makeFakeCtx(),
      () => resolveRender?.(),
      fakeSnapshot,
      fakeDraw,
    );
  });

  const scheduleAndWait = async (moves: Move[]) => {
    const pending = waitForRender();
    renderer.schedule(moves);
    await pending;
  };

  it('draws every move in order on the first render, with no checkpoint below the offset', async () => {
    const moves = makeMoves(5);

    await scheduleAndWait(moves);

    expect(drawnLog).toEqual(moves.map((m) => m.id));
    expect(snapshotCount).toBe(0);
  });

  it('takes a checkpoint once past the offset, then only draws the tail on append', async () => {
    const initial = makeMoves(35);

    await scheduleAndWait(initial);

    expect(drawnLog).toEqual(initial.map((m) => m.id));
    expect(snapshotCount).toBe(1);

    drawnLog = [];

    const appended = [...initial, makeMove({ id: 'move-35', seq: 35 })];

    await scheduleAndWait(appended);

    // Only the tail (past the checkpoint boundary) was redrawn.
    expect(drawnLog).toEqual(appended.slice(5).map((m) => m.id));
    // Still just the one snapshot from the initial full replay.
    expect(snapshotCount).toBe(1);
  });

  it('falls back to a full replay when a move inside the checkpoint is removed', async () => {
    const initial = makeMoves(35);

    await scheduleAndWait(initial);
    drawnLog = [];

    // Undo removed move-2, which sits inside the checkpoint's first 5 moves.
    const afterUndo = initial.filter((m) => m.id !== 'move-2');

    await scheduleAndWait(afterUndo);

    expect(drawnLog).toEqual(afterUndo.map((m) => m.id));
    expect(snapshotCount).toBe(2);
  });

  it('checkpoint path and full-replay path incorporate the same moves, in the same order', async () => {
    const all = makeMoves(40);

    // Full replay of everything in one shot.
    const fullDrawnLog: string[] = [];

    await new Promise<void>((resolve) => {
      const fullRenderer = new CommittedRenderer(
        makeFakeCtx(),
        resolve,
        async () => ({}) as unknown as ImageBitmap,
        (_ctx, move) => fullDrawnLog.push(move.id),
      );
      fullRenderer.schedule(all);
    });

    // Checkpoint path: render a prefix first (establishing a checkpoint),
    // then append the rest incrementally.
    const prefix = all.slice(0, 35);
    await scheduleAndWait(prefix);

    const checkpointSeqs = prefix.slice(0, 5).map((m) => m.id);
    drawnLog = [];

    await scheduleAndWait(all);

    const composedFinalState = [...checkpointSeqs, ...drawnLog];

    expect(composedFinalState).toEqual(fullDrawnLog);
  });
});
