import type { Handle } from '@/common/render/vector/Renderer';
import type { BoardObject, Rect } from '@/common/vector/types';

/** Applies a resize handle drag to a box, keeping the opposite side fixed. */
export const resizeBox = (
  start: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  keepAspect = false,
  minSize = 8,
): Rect => {
  let { x, y, w, h } = start;

  if (handle.includes('e')) w = Math.max(minSize, start.w + dx);
  if (handle.includes('s')) h = Math.max(minSize, start.h + dy);
  if (handle.includes('w')) {
    w = Math.max(minSize, start.w - dx);
    x = start.x + start.w - w;
  }
  if (handle.includes('n')) {
    h = Math.max(minSize, start.h - dy);
    y = start.y + start.h - h;
  }

  if (keepAspect && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    const corner = handle.length === 2;

    if (corner) {
      if (Math.abs(w - start.w) > Math.abs(h - start.h) * ratio) h = w / ratio;
      else w = h * ratio;

      if (handle.includes('w')) x = start.x + start.w - w;
      if (handle.includes('n')) y = start.y + start.h - h;
    }
  }

  return { x, y, w, h };
};

/**
 * Scales every object in a selection so the selection box goes from
 * `before` to `after`: positions and sizes interpolate, stroke points scale.
 */
export const scaleObjectsInto = (objects: BoardObject[], before: Rect, after: Rect): Partial<BoardObject>[] => {
  const sx = before.w ? after.w / before.w : 1;
  const sy = before.h ? after.h / before.h : 1;

  return objects.map((object) => {
    const x = after.x + (object.x - before.x) * sx;
    const y = after.y + (object.y - before.y) * sy;
    const w = object.w * sx;
    const h = object.h * sy;

    if (object.type === 'stroke') {
      return {
        id: object.id,
        x,
        y,
        w,
        h,
        points: object.points.map(([px, py, pressure]) => [px * sx, py * sy, pressure] as [number, number, number]),
        size: object.size * Math.min(sx, sy),
      };
    }

    if (object.type === 'text') {
      return { id: object.id, x, y, w, h, fontSize: Math.max(6, object.fontSize * Math.min(sx, sy)) };
    }

    return { id: object.id, x, y, w, h };
  });
};

/** Angle in degrees from a box centre to a point, measured from straight up. */
export const angleFromCenter = (center: { x: number; y: number }, point: { x: number; y: number }) =>
  (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI + 90;
