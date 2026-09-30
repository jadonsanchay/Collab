import type { Point, Rect } from './types';

/**
 * The view onto an unbounded world: `x`, `y` is the world point at the
 * screen origin, `zoom` is screen pixels per world unit.
 */
export type Camera = { x: number; y: number; zoom: number };

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export const worldToScreen = (point: Point, camera: Camera): Point => ({
  x: (point.x - camera.x) * camera.zoom,
  y: (point.y - camera.y) * camera.zoom,
});

export const screenToWorld = (point: Point, camera: Camera): Point => ({
  x: point.x / camera.zoom + camera.x,
  y: point.y / camera.zoom + camera.y,
});

/** Moves the camera by a screen-space delta (a drag). */
export const panBy = (camera: Camera, dx: number, dy: number): Camera => ({
  ...camera,
  x: camera.x - dx / camera.zoom,
  y: camera.y - dy / camera.zoom,
});

/** Zooms so that the world point under `screen` stays under it. */
export const zoomAt = (camera: Camera, screen: Point, factor: number): Camera => {
  const zoom = clampZoom(camera.zoom * factor);
  const anchor = screenToWorld(screen, camera);

  return {
    zoom,
    x: anchor.x - screen.x / zoom,
    y: anchor.y - screen.y / zoom,
  };
};

/** The world rectangle the viewport shows. */
export const visibleWorld = (camera: Camera, viewport: { width: number; height: number }): Rect => ({
  x: camera.x,
  y: camera.y,
  w: viewport.width / camera.zoom,
  h: viewport.height / camera.zoom,
});

/** A camera that shows `bounds` with a margin, centred, zoom clamped. */
export const fitTo = (
  bounds: Rect,
  viewport: { width: number; height: number },
  margin = 40,
): Camera => {
  const w = Math.max(bounds.w, 1);
  const h = Math.max(bounds.h, 1);
  const zoom = clampZoom(
    Math.min((viewport.width - margin * 2) / w, (viewport.height - margin * 2) / h),
  );

  return {
    zoom,
    x: bounds.x + w / 2 - viewport.width / 2 / zoom,
    y: bounds.y + h / 2 - viewport.height / 2 / zoom,
  };
};
