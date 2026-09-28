import { create } from 'zustand';

import { CtxOptions, Point } from '@/common/types/global';

export type LiveStroke = {
  userId: string;
  options: CtxOptions;
  points: Point[];
};

type LiveStrokesState = {
  strokes: Map<string, LiveStroke>;
  start: (strokeId: string, userId: string, options: CtxOptions, from: Point) => void;
  appendPoints: (strokeId: string, points: Point[]) => void;
  remove: (strokeId: string) => void;
};

/**
 * Keyed by `strokeId` (the sender's move `clientId`), not `userId`: two
 * strokes from the same user should never collide, but this also means a
 * stray `live_stroke_points` for an unknown id (arrived before its
 * `live_stroke_start`, or after removal) is silently ignored rather than
 * fabricating a stroke with no `options`.
 */
export const useLiveStrokesStore = create<LiveStrokesState>((set) => ({
  strokes: new Map(),

  start: (strokeId, userId, options, from) =>
    set((state) => {
      const strokes = new Map(state.strokes);
      strokes.set(strokeId, { userId, options, points: [from] });
      return { strokes };
    }),

  appendPoints: (strokeId, points) =>
    set((state) => {
      const existing = state.strokes.get(strokeId);
      if (!existing) return state;

      const strokes = new Map(state.strokes);
      strokes.set(strokeId, { ...existing, points: [...existing.points, ...points] });
      return { strokes };
    }),

  remove: (strokeId) =>
    set((state) => {
      if (!state.strokes.has(strokeId)) return state;

      const strokes = new Map(state.strokes);
      strokes.delete(strokeId);
      return { strokes };
    }),
}));
