import type { Rect } from '@/common/vector/types';

export type SnapResult = { dx: number; dy: number; guides: { x: number[]; y: number[] } };

/**
 * Snaps a moving box to the edges and centres of nearby boxes. `threshold`
 * is in world units (the caller divides screen pixels by zoom). Returns the
 * correction to apply and the guide lines to draw.
 */
export const snapRect = (moving: Rect, others: Rect[], threshold: number): SnapResult => {
  const xs = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const ys = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

  let bestX: { delta: number; guide: number } | null = null;
  let bestY: { delta: number; guide: number } | null = null;

  others.forEach((other) => {
    const candidateXs = [other.x, other.x + other.w / 2, other.x + other.w];
    const candidateYs = [other.y, other.y + other.h / 2, other.y + other.h];

    xs.forEach((x) => {
      candidateXs.forEach((candidate) => {
        const delta = candidate - x;

        if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          bestX = { delta, guide: candidate };
        }
      });
    });

    ys.forEach((y) => {
      candidateYs.forEach((candidate) => {
        const delta = candidate - y;

        if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          bestY = { delta, guide: candidate };
        }
      });
    });
  });

  const snappedX = bestX as { delta: number; guide: number } | null;
  const snappedY = bestY as { delta: number; guide: number } | null;

  return {
    dx: snappedX?.delta ?? 0,
    dy: snappedY?.delta ?? 0,
    guides: { x: snappedX ? [snappedX.guide] : [], y: snappedY ? [snappedY.guide] : [] },
  };
};
