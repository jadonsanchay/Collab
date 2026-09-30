import { CANVAS_SIZE } from '@/common/constants/canvasSize';
import { canvasToPngBase64 } from '@/common/lib/resizeImage';
import type { BoardRect } from '@/common/types/global';

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/** Normalises a rectangle (negative sizes allowed) and clips it to the board. */
export const clipToBoard = (rect: BoardRect): BoardRect => {
  const x1 = clamp(Math.min(rect.x, rect.x + rect.width), 0, CANVAS_SIZE.width);
  const y1 = clamp(Math.min(rect.y, rect.y + rect.height), 0, CANVAS_SIZE.height);
  const x2 = clamp(Math.max(rect.x, rect.x + rect.width), 0, CANVAS_SIZE.width);
  const y2 = clamp(Math.max(rect.y, rect.y + rect.height), 0, CANVAS_SIZE.height);

  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
};

/**
 * A PNG of one board region: background first, then the committed drawing,
 * so the model sees what people see. Null when the region is empty or the
 * image cannot be made small enough for the wire.
 */
export const captureRegion = (
  committed: HTMLCanvasElement,
  background: HTMLCanvasElement | null,
  rect: BoardRect,
): string | null => {
  const region = clipToBoard(rect);

  if (region.width < 1 || region.height < 1) return null;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(region.width);
  canvas.height = Math.round(region.height);

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const draw = (source: HTMLCanvasElement) =>
    ctx.drawImage(
      source,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );

  if (background) draw(background);
  draw(committed);

  return canvasToPngBase64(canvas) || null;
};
