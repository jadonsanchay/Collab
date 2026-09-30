import { describe, expect, it } from 'vitest';

import type { Move } from '@/common/types/global';
import { byZ } from '@/common/vector/order';

import { movesToObjects, planUpgrade } from './fromMoves';

const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const CLEAR = { r: 0, g: 0, b: 0, a: 0 };

type Overrides = Omit<Partial<Move>, 'options'> & { options?: Partial<Move['options']> };

const move = (seq: number, overrides: Overrides): Move => ({
  id: `m${seq}`,
  clientId: `c${seq}`,
  seq,
  timestamp: seq,
  userId: 'alice',
  circle: { cX: 0, cY: 0, radiusX: 0, radiusY: 0 },
  rect: { width: 0, height: 0 },
  img: {},
  path: [[10, 10]],
  ...overrides,
  options: {
    lineWidth: 4,
    lineColor: BLACK,
    fillColor: CLEAR,
    shape: 'line',
    mode: 'draw',
    selection: null,
    ...overrides.options,
  },
});

describe('movesToObjects', () => {
  it('converts each kind of move to its object, in sequence order, marked legacy', () => {
    const objects = movesToObjects(
      [
        move(3, { options: { shape: 'rect' }, path: [[100, 100]], rect: { width: -50, height: 40 } }),
        move(1, { path: [[0, 0], [10, 20], [30, 5]] }),
        move(2, {
          options: { shape: 'circle', fillColor: { r: 255, g: 0, b: 0, a: 0.5 } },
          circle: { cX: 50, cY: 60, radiusX: 20, radiusY: 10 },
        }),
        move(4, { options: { shape: 'text' }, path: [[5, 5]], text: { content: 'hello\nworld!', fontSize: 20 } }),
        move(5, { options: { shape: 'image' }, path: [[7, 8]], img: { url: '/uploads/a.png', width: 120, height: 80 } }),
        move(6, { options: { mode: 'select' } }),
      ],
      'owner',
    );

    expect(objects.map((object) => object.type)).toEqual(['stroke', 'shape', 'shape', 'text', 'image']);
    expect([...objects].sort(byZ).map((object) => object.id)).toEqual(objects.map((object) => object.id));
    objects.forEach((object) => expect(object.meta).toEqual({ legacy: true }));
    objects.forEach((object) => expect(object.createdBy).toBe('alice'));

    const [stroke, ellipse, rect, text, image] = objects;

    expect(stroke).toMatchObject({ type: 'stroke', color: 'rgba(0, 0, 0, 1)', size: 4 });
    expect(stroke.x).toBeLessThanOrEqual(0);
    expect(stroke.w).toBeGreaterThanOrEqual(30);

    expect(ellipse).toMatchObject({ type: 'shape', kind: 'ellipse', x: 30, y: 50, w: 40, h: 20, fill: 'rgba(255, 0, 0, 0.5)' });
    // A drag up and to the left still gives a positive box.
    expect(rect).toMatchObject({ type: 'shape', kind: 'rect', x: 50, y: 100, w: 50, h: 40, fill: null });
    expect(text).toMatchObject({ type: 'text', text: 'hello\nworld!', fontSize: 20, x: 5, y: 5 });
    expect(text.h).toBeCloseTo(52);
    expect(image).toMatchObject({ type: 'image', url: '/uploads/a.png', w: 120, h: 80, x: 7, y: 8 });
  });

  it('skips eraser moves and moves without a path', () => {
    expect(movesToObjects([move(1, { options: { mode: 'eraser' } }), move(2, { path: [] })], 'owner')).toEqual([]);
  });
});

describe('planUpgrade', () => {
  it('keeps every move as an object when the eraser was never used', () => {
    const plan = planUpgrade([move(2, {}), move(1, {}), move(3, { options: { mode: 'select' } })]);

    expect(plan.strategy).toBe('objects');
    if (plan.strategy === 'objects') expect(plan.moves.map((m) => m.seq)).toEqual([1, 2]);
  });

  it('flattens up to the last erase and keeps later text and images as objects', () => {
    const plan = planUpgrade([
      move(1, {}),
      move(2, { options: { shape: 'text' }, text: { content: 'early', fontSize: 12 } }),
      move(3, { options: { mode: 'eraser' } }),
      move(4, {}),
      move(5, { options: { shape: 'text' }, text: { content: 'late', fontSize: 12 } }),
      move(6, { options: { shape: 'image' }, img: { url: '/uploads/b.png' } }),
    ]);

    expect(plan.strategy).toBe('image');
    if (plan.strategy === 'image') {
      expect(plan.flattened.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
      expect(plan.after.map((m) => m.seq)).toEqual([5, 6]);
    }
  });
});
