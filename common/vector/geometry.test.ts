import { describe, expect, it } from 'vitest';

import {
  aabb,
  anchorPoint,
  boundsOfPoints,
  hitsObject,
  nearestSide,
  normalizeRect,
  rectContains,
  rectsIntersect,
  resolveAnchor,
  rotatePoint,
  topmostAt,
  unionRect,
} from './geometry';
import type { BoardObject, ShapeObject, StrokeObject } from './types';

const shape = (overrides: Partial<ShapeObject> = {}): ShapeObject => ({
  id: 's',
  type: 'shape',
  kind: 'rect',
  x: 100,
  y: 100,
  w: 200,
  h: 100,
  rotation: 0,
  z: 'a0',
  createdBy: 'u',
  createdAt: 0,
  stroke: '#000',
  fill: null,
  strokeWidth: 2,
  text: '',
  ...overrides,
});

describe('geometry', () => {
  it('rotates points around a centre', () => {
    const rotated = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);

    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(10);
  });

  it('computes axis-aligned bounds of a rotated box', () => {
    const box = aabb({ x: 0, y: 0, w: 100, h: 50, rotation: 90 });

    expect(box.x).toBeCloseTo(25);
    expect(box.y).toBeCloseTo(-25);
    expect(box.w).toBeCloseTo(50);
    expect(box.h).toBeCloseTo(100);
    expect(aabb({ x: 1, y: 2, w: 3, h: 4 })).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it('tests rectangles against each other', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(false);
    expect(rectContains({ x: 0, y: 0, w: 10, h: 10 }, { x: 1, y: 1, w: 2, h: 2 })).toBe(true);
    expect(rectContains({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 2, h: 2 })).toBe(false);
    expect(unionRect([{ x: 0, y: 0, w: 1, h: 1 }, { x: 5, y: 5, w: 1, h: 1 }])).toEqual({ x: 0, y: 0, w: 6, h: 6 });
    expect(unionRect([])).toBeNull();
    expect(normalizeRect({ x: 5, y: 5 }, { x: 1, y: 2 })).toEqual({ x: 1, y: 2, w: 4, h: 3 });
  });

  it('hits boxes with rotation and strokes within their width', () => {
    expect(hitsObject({ x: 150, y: 150 }, shape())).toBe(true);
    expect(hitsObject({ x: 50, y: 50 }, shape())).toBe(false);

    // A box rotated 90 degrees around its centre (200, 150) covers x 150..250, y 50..250.
    const rotated = shape({ rotation: 90 });
    expect(hitsObject({ x: 200, y: 60 }, rotated)).toBe(true);
    expect(hitsObject({ x: 110, y: 150 }, rotated)).toBe(false);

    const stroke: StrokeObject = {
      id: 'k',
      type: 'stroke',
      x: 0,
      y: 0,
      w: 100,
      h: 0,
      rotation: 0,
      z: 'a1',
      createdBy: 'u',
      createdAt: 0,
      color: '#000',
      size: 6,
      points: [
        [0, 0, 0.5],
        [100, 0, 0.5],
      ],
    };

    expect(hitsObject({ x: 50, y: 5 }, stroke)).toBe(true);
    expect(hitsObject({ x: 50, y: 20 }, stroke)).toBe(false);
  });

  it('picks the topmost unlocked object under a point', () => {
    const bottom = shape({ id: 'bottom', z: 'a0' });
    const top = shape({ id: 'top', z: 'a1' });
    const locked = shape({ id: 'locked', z: 'a2', locked: true });

    expect(topmostAt({ x: 150, y: 150 }, [bottom, top, locked] as BoardObject[])?.id).toBe('top');
    expect(topmostAt({ x: 5, y: 5 }, [bottom, top])).toBeNull();
  });

  it('resolves anchors on box sides, rotated, and picks the nearest side', () => {
    const box = shape();

    expect(anchorPoint(box, 'right')).toEqual({ x: 300, y: 150 });
    expect(anchorPoint(box, 'center')).toEqual({ x: 200, y: 150 });

    const rotated = anchorPoint(shape({ rotation: 90 }), 'top');
    expect(rotated.x).toBeCloseTo(250);
    expect(rotated.y).toBeCloseTo(150);

    const objects = new Map<string, BoardObject>([[box.id, box]]);
    expect(resolveAnchor({ objectId: 's', side: 'left' }, objects)).toEqual({ x: 100, y: 150 });
    expect(resolveAnchor({ objectId: 'missing', side: 'left' }, objects)).toBeNull();
    expect(resolveAnchor({ x: 1, y: 2 }, objects)).toEqual({ x: 1, y: 2 });
    expect(nearestSide(box, { x: 320, y: 140 })).toBe('right');
    expect(nearestSide(box, { x: 200, y: 90 })).toBe('top');
  });

  it('bounds a set of points with padding', () => {
    expect(boundsOfPoints([{ x: 10, y: 10 }, { x: 20, y: 30 }], 5)).toEqual({ x: 5, y: 5, w: 20, h: 30 });
  });
});
