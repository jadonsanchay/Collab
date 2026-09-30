import { describe, expect, it } from 'vitest';

import { fitTo, MAX_ZOOM, panBy, screenToWorld, visibleWorld, worldToScreen, zoomAt } from './camera';

describe('camera', () => {
  const camera = { x: 100, y: 50, zoom: 2 };

  it('maps between world and screen and back', () => {
    const screen = worldToScreen({ x: 150, y: 100 }, camera);

    expect(screen).toEqual({ x: 100, y: 100 });
    expect(screenToWorld(screen, camera)).toEqual({ x: 150, y: 100 });
  });

  it('pans by screen pixels scaled by zoom', () => {
    expect(panBy(camera, 20, -10)).toEqual({ x: 90, y: 55, zoom: 2 });
  });

  it('keeps the point under the cursor fixed while zooming, within the limits', () => {
    const cursor = { x: 300, y: 200 };
    const before = screenToWorld(cursor, camera);
    const after = zoomAt(camera, cursor, 1.5);

    expect(after.zoom).toBe(3);
    expect(screenToWorld(cursor, after).x).toBeCloseTo(before.x);
    expect(screenToWorld(cursor, after).y).toBeCloseTo(before.y);

    expect(zoomAt(camera, cursor, 1000).zoom).toBe(MAX_ZOOM);
  });

  it('describes the visible world rectangle', () => {
    expect(visibleWorld(camera, { width: 800, height: 600 })).toEqual({ x: 100, y: 50, w: 400, h: 300 });
  });

  it('fits a rectangle centred in the viewport', () => {
    const fitted = fitTo({ x: 0, y: 0, w: 1000, h: 500 }, { width: 1080, height: 580 }, 40);

    expect(fitted.zoom).toBe(1);
    expect(fitted.x).toBe(500 - 540);
    expect(fitted.y).toBe(250 - 290);
  });
});
