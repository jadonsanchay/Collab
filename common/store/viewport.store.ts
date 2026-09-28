import { create } from 'zustand';

import { CANVAS_SIZE } from '@/common/constants/canvasSize';

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;

type ViewportState = {
  x: number;
  y: number;
  scale: number;
  panBy: (dx: number, dy: number, viewportSize: { width: number; height: number }) => void;
  zoomAt: (
    screenX: number,
    screenY: number,
    scaleDelta: number,
    viewportSize: { width: number; height: number },
  ) => void;
  zoomTo: (scale: number, viewportSize: { width: number; height: number }) => void;
  fitToBoard: (viewportSize: { width: number; height: number }) => void;
  reset: () => void;
};

const clampScale = (scale: number) =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/**
 * The board may never leave the viewport entirely: when the scaled board is
 * wider/taller than the viewport, clamp so at least the viewport is covered;
 * otherwise center it.
 */
const clampAxis = (value: number, boardSize: number, viewportSize: number, scale: number) => {
  const scaledSize = boardSize * scale;

  if (scaledSize <= viewportSize) return (viewportSize - scaledSize) / 2;

  return Math.min(0, Math.max(viewportSize - scaledSize, value));
};

export const useViewportStore = create<ViewportState>((set, get) => ({
  x: 0,
  y: 0,
  scale: 1,

  panBy: (dx, dy, viewportSize) => {
    const { x, y, scale } = get();

    set({
      x: clampAxis(x + dx, CANVAS_SIZE.width, viewportSize.width, scale),
      y: clampAxis(y + dy, CANVAS_SIZE.height, viewportSize.height, scale),
    });
  },

  zoomAt: (screenX, screenY, scaleDelta, viewportSize) => {
    const { x, y, scale } = get();
    const newScale = clampScale(scale * (1 + scaleDelta));

    // Keep the board point under the cursor fixed on screen while scale changes.
    const boardX = (screenX - x) / scale;
    const boardY = (screenY - y) / scale;

    set({
      scale: newScale,
      x: clampAxis(screenX - boardX * newScale, CANVAS_SIZE.width, viewportSize.width, newScale),
      y: clampAxis(screenY - boardY * newScale, CANVAS_SIZE.height, viewportSize.height, newScale),
    });
  },

  zoomTo: (scale, viewportSize) => {
    get().zoomAt(
      viewportSize.width / 2,
      viewportSize.height / 2,
      scale / get().scale - 1,
      viewportSize,
    );
  },

  fitToBoard: (viewportSize) => {
    const newScale = clampScale(
      Math.min(
        viewportSize.width / CANVAS_SIZE.width,
        viewportSize.height / CANVAS_SIZE.height,
      ),
    );

    set({
      scale: newScale,
      x: (viewportSize.width - CANVAS_SIZE.width * newScale) / 2,
      y: (viewportSize.height - CANVAS_SIZE.height * newScale) / 2,
    });
  },

  reset: () => set({ x: 0, y: 0, scale: 1 }),
}));
