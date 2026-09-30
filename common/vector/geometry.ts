import type { Anchor, AnchorSide, BoardObject, Point, Rect, StrokeObject } from './types';

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export const rectCenter = (rect: Rect): Point => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

/** Rotates `point` around `center` by `degrees`. */
export const rotatePoint = (point: Point, center: Point, degrees: number): Point => {
  if (!degrees) return point;

  const angle = toRadians(degrees);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
};

/** The four corners of an object's box after rotation, clockwise from top-left. */
export const corners = (object: Rect & { rotation?: number }): Point[] => {
  const center = rectCenter(object);
  const raw: Point[] = [
    { x: object.x, y: object.y },
    { x: object.x + object.w, y: object.y },
    { x: object.x + object.w, y: object.y + object.h },
    { x: object.x, y: object.y + object.h },
  ];

  return raw.map((corner) => rotatePoint(corner, center, object.rotation ?? 0));
};

/** Axis-aligned bounds of a possibly rotated object, for indexing and culling. */
export const aabb = (object: Rect & { rotation?: number }): Rect => {
  if (!object.rotation) return { x: object.x, y: object.y, w: object.w, h: object.h };

  const points = corners(object);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
};

export const rectsIntersect = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const rectContains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

/** Bounding box of several rectangles; null for none. */
export const unionRect = (rects: Rect[]): Rect | null => {
  if (!rects.length) return null;

  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

/** Normalises a drag rectangle so `w` and `h` are non-negative. */
export const normalizeRect = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(b.x - a.x),
  h: Math.abs(b.y - a.y),
});

/** Brings a world point into an object's local, unrotated frame. */
export const toLocal = (point: Point, object: Rect & { rotation?: number }): Point => {
  const local = rotatePoint(point, rectCenter(object), -(object.rotation ?? 0));

  return { x: local.x - object.x, y: local.y - object.y };
};

const distanceToSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));

  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** Distance from a local point to the stroke's polyline. */
export const distanceToStroke = (local: Point, stroke: StrokeObject) => {
  const { points } = stroke;

  if (points.length === 1) return Math.hypot(local.x - points[0][0], local.y - points[0][1]);

  let best = Infinity;

  for (let i = 1; i < points.length; i += 1) {
    const d = distanceToSegment(
      local,
      { x: points[i - 1][0], y: points[i - 1][1] },
      { x: points[i][0], y: points[i][1] },
    );

    if (d < best) best = d;
  }

  return best;
};

/**
 * Does the point land on this object? Boxes use their rotated rectangle,
 * strokes their polyline within half their width plus a tolerance, so a
 * thin stroke can still be clicked.
 */
export const hitsObject = (point: Point, object: BoardObject, tolerance = 4): boolean => {
  const local = toLocal(point, object);

  if (object.type === 'stroke') {
    return distanceToStroke(local, object) <= object.size / 2 + tolerance;
  }

  if (object.type === 'connector') {
    // Connectors are hit along their path; the caller resolves the path.
    return false;
  }

  return local.x >= -tolerance && local.y >= -tolerance && local.x <= object.w + tolerance && local.y <= object.h + tolerance;
};

/** Topmost object under a point, given objects in z order (bottom first). */
export const topmostAt = (point: Point, objectsBottomFirst: BoardObject[]): BoardObject | null => {
  for (let i = objectsBottomFirst.length - 1; i >= 0; i -= 1) {
    if (!objectsBottomFirst[i].locked && hitsObject(point, objectsBottomFirst[i])) return objectsBottomFirst[i];
  }

  return null;
};

/** World point of an anchor side on an object's rotated box. */
export const anchorPoint = (object: Rect & { rotation?: number }, side: AnchorSide): Point => {
  const center = rectCenter(object);
  const local: Record<AnchorSide, Point> = {
    center,
    top: { x: center.x, y: object.y },
    bottom: { x: center.x, y: object.y + object.h },
    left: { x: object.x, y: center.y },
    right: { x: object.x + object.w, y: center.y },
  };

  return rotatePoint(local[side], center, object.rotation ?? 0);
};

/** Resolves an anchor to a world point; null when it names a missing object. */
export const resolveAnchor = (anchor: Anchor, objects: Map<string, BoardObject>): Point | null => {
  if ('objectId' in anchor) {
    const target = objects.get(anchor.objectId);

    return target ? anchorPoint(target, anchor.side) : null;
  }

  return { x: anchor.x, y: anchor.y };
};

/** The side of `object` closest to `point`, for snapping a connector end. */
export const nearestSide = (object: Rect & { rotation?: number }, point: Point): AnchorSide => {
  const sides: AnchorSide[] = ['top', 'right', 'bottom', 'left'];
  let best: AnchorSide = 'center';
  let bestDistance = Infinity;

  sides.forEach((side) => {
    const candidate = anchorPoint(object, side);
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);

    if (distance < bestDistance) {
      bestDistance = distance;
      best = side;
    }
  });

  return best;
};

/** Points along a stroke as world coordinates. */
export const strokeWorldPoints = (stroke: StrokeObject): Point[] =>
  stroke.points.map(([x, y]) => ({ x: stroke.x + x, y: stroke.y + y }));

/** Bounds of a set of points with a padding, e.g. a stroke's box. */
export const boundsOfPoints = (points: Point[], padding = 0): Rect => {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;

  return { x: minX, y: minY, w: Math.max(...xs) + padding - minX, h: Math.max(...ys) + padding - minY };
};
