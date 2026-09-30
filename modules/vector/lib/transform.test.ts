import { describe, expect, it } from 'vitest';

import type { StrokeObject } from '@/common/vector/types';

import { angleFromCenter, resizeBox, scaleObjectsInto } from './transform';

describe('transform helpers', () => {
  const box = { x: 100, y: 100, w: 200, h: 100 };

  it('resizes from each side keeping the opposite side fixed', () => {
    expect(resizeBox(box, 'e', 50, 0)).toEqual({ x: 100, y: 100, w: 250, h: 100 });
    expect(resizeBox(box, 'w', 50, 0)).toEqual({ x: 150, y: 100, w: 150, h: 100 });
    expect(resizeBox(box, 'n', 0, -30)).toEqual({ x: 100, y: 70, w: 200, h: 130 });
    expect(resizeBox(box, 'se', 20, 20)).toEqual({ x: 100, y: 100, w: 220, h: 120 });
  });

  it('never collapses below the minimum and keeps aspect on corners when asked', () => {
    expect(resizeBox(box, 'e', -500, 0).w).toBe(8);

    const kept = resizeBox(box, 'se', 100, 0, true);
    expect(kept.w / kept.h).toBeCloseTo(2);
  });

  it('scales objects into a new selection box, stroke points included', () => {
    const stroke: StrokeObject = {
      id: 's',
      type: 'stroke',
      x: 100,
      y: 100,
      w: 100,
      h: 50,
      rotation: 0,
      z: 'a0',
      createdBy: 'u',
      createdAt: 0,
      color: '#000',
      size: 4,
      points: [
        [0, 0, 0.5],
        [100, 50, 0.5],
      ],
    };

    const [patch] = scaleObjectsInto([stroke], box, { x: 100, y: 100, w: 400, h: 100 });

    expect(patch).toMatchObject({ x: 100, y: 100, w: 200, h: 50, size: 4 });
    expect((patch as StrokeObject).points[1]).toEqual([200, 50, 0.5]);
  });

  it('measures rotation from straight up', () => {
    expect(angleFromCenter({ x: 0, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(0);
    expect(angleFromCenter({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90);
  });
});
