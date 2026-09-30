import { describe, expect, it } from 'vitest';

import type { FrameObject } from '@/common/vector/types';

import { childrenOf, duplicateObject, newConnector, newShape, newSticky, newStroke, newText } from './objects';

const common = { z: 'a0', createdBy: 'alice', now: 5 };

describe('object factories', () => {
  it('builds a stroke whose box bounds the points, with points made relative', () => {
    const stroke = newStroke(
      [
        [100, 100, 0.5],
        [150, 120, 0.5],
      ],
      { color: '#000', size: 4 },
      common,
    );

    expect(stroke).toMatchObject({ type: 'stroke', x: 98, y: 98, w: 54, h: 24, color: '#000', size: 4 });
    expect(stroke.points).toEqual([
      [2, 2, 0.5],
      [52, 22, 0.5],
    ]);
    expect(stroke.createdAt).toBe(5);
  });

  it('normalises box shapes but keeps direction for lines and arrows', () => {
    const rect = newShape('rect', { x: 100, y: 100 }, { x: 40, y: 60 }, { stroke: '#000', fill: null, strokeWidth: 2 }, common);
    const arrow = newShape('arrow', { x: 100, y: 100 }, { x: 40, y: 60 }, { stroke: '#000', fill: null, strokeWidth: 2 }, common);

    expect(rect).toMatchObject({ x: 40, y: 60, w: 60, h: 40 });
    expect(arrow).toMatchObject({ x: 100, y: 100, w: -60, h: -40 });
  });

  it('centres a sticky on the click and starts text empty', () => {
    const sticky = newSticky({ x: 300, y: 300 }, '#FEF08A', common);

    expect(sticky).toMatchObject({ x: 200, y: 200, w: 200, h: 200, text: '' });
    expect(newText({ x: 1, y: 2 }, { color: '#000', fontSize: 20 }, common)).toMatchObject({ x: 1, y: 2, text: '', h: 26 });
  });

  it('builds a connector with arrow end and no box of its own', () => {
    const connector = newConnector({ objectId: 'a', side: 'right' }, { x: 5, y: 5 }, { stroke: '#000', strokeWidth: 2 }, common);

    expect(connector).toMatchObject({ type: 'connector', arrowEnd: true, style: 'straight', w: 0, h: 0 });
  });

  it('finds a frame’s children and duplicates with an offset and a new id', () => {
    const frame: FrameObject = { id: 'f', type: 'frame', x: 0, y: 0, w: 500, h: 500, rotation: 0, z: 'a0', createdBy: 'u', createdAt: 0, title: 'F' };
    const inside = newSticky({ x: 200, y: 200 }, '#fff', common);
    const outside = newSticky({ x: 900, y: 200 }, '#fff', common);

    expect(childrenOf(frame, [frame, inside, outside]).map((o) => o.id)).toEqual([inside.id]);

    const copy = duplicateObject(inside, 'a5');

    expect(copy.id).not.toBe(inside.id);
    expect(copy).toMatchObject({ x: inside.x + 20, y: inside.y + 20, z: 'a5' });
  });
});
