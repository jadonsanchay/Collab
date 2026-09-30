import { type Canvas, createCanvas } from '@napi-rs/canvas';

import { CANVAS_SIZE } from '@/common/constants/canvasSize';
import { type BackgroundSetting, drawBackground } from '@/common/render/drawBackground';
import {
  drawMove,
  type ImageCache,
  type ImageLoader,
  preloadImages,
} from '@/common/render/drawMove';
import type { Move } from '@/common/types/global';

export type RenderOptions = {
  /** Output scale: 1 for a snapshot, 0.12 for a 480 px thumbnail. */
  scale?: number;
  /** Null renders on a transparent canvas, which is what a snapshot needs. */
  background?: BackgroundSetting | null;
  loader: ImageLoader;
};

/**
 * Draws a board's moves onto a Node canvas with the same `drawMove` the
 * browser uses, so a snapshot or a thumbnail is what the user sees. Moves
 * are drawn in sequence order regardless of the order given.
 */
export const renderBoard = async (moves: Move[], options: RenderOptions): Promise<Canvas> => {
  const scale = options.scale ?? 1;
  const canvas = createCanvas(
    Math.max(1, Math.round(CANVAS_SIZE.width * scale)),
    Math.max(1, Math.round(CANVAS_SIZE.height * scale)),
  );
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;

  ctx.scale(scale, scale);

  if (options.background) {
    drawBackground(ctx, CANVAS_SIZE.width, CANVAS_SIZE.height, options.background);
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const cache: ImageCache = new Map();
  await preloadImages(moves, cache, options.loader);

  [...moves]
    .sort((a, b) => a.seq - b.seq)
    .forEach((move) => drawMove(ctx, move, cache, options.loader));

  return canvas;
};

export const encodePng = (canvas: Canvas) => canvas.encode('png');

export const encodeWebp = (canvas: Canvas, quality = 80) => canvas.encode('webp', quality);
