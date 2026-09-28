import { create } from 'zustand';

type Point = [number, number];

export const DEFAULT_TEMP_CIRCLE = { cX: 0, cY: 0, radiusX: 0, radiusY: 0 };
export const DEFAULT_TEMP_SIZE = { width: 0, height: 0 };

type DrawingState = {
  tempMoves: Point[];
  tempCircle: typeof DEFAULT_TEMP_CIRCLE;
  tempSize: typeof DEFAULT_TEMP_SIZE;
  /**
   * Generated once per stroke at pointer-down, and reused as the eventual
   * `draw` move's `clientId` — the live-stroke broadcast's `strokeId` is
   * this same value, so a receiver can match the preview to the committed
   * move that replaces it.
   */
  strokeId: string | null;
};

/**
 * Read via `getState()`/written via `setState()` from `useDraw`, not the
 * `useDrawingStore()` hook — this tracks the in-progress stroke on every
 * pointer move and must not trigger a re-render.
 */
export const useDrawingStore = create<DrawingState>(() => ({
  tempMoves: [],
  tempCircle: DEFAULT_TEMP_CIRCLE,
  tempSize: DEFAULT_TEMP_SIZE,
  strokeId: null,
}));
