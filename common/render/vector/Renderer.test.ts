import { describe, expect, it } from 'vitest';

import type { BoardObject, ConnectorObject, ShapeObject, StrokeObject } from '@/common/vector/types';

import { connectorBounds, connectorPoints, handlePositionsOf, objectBounds } from './Renderer';

const shape = (id: string, x: number, y: number): ShapeObject => ({
  id,
  type: 'shape',
  kind: 'rect',
  x,
  y,
  w: 100,
  h: 50,
  rotation: 0,
  z: 'a0',
  createdBy: 'u',
  createdAt: 0,
  stroke: '#000',
  fill: null,
  strokeWidth: 2,
  text: '',
});

describe('renderer geometry helpers', () => {
  const a = shape('a', 0, 0);
  const b = shape('b', 300, 200);
  const objects = new Map<string, BoardObject>([
    ['a', a],
    ['b', b],
  ]);

  const connector: ConnectorObject = {
    id: 'c',
    type: 'connector',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    rotation: 0,
    z: 'a1',
    createdBy: 'u',
    createdAt: 0,
    from: { objectId: 'a', side: 'right' },
    to: { objectId: 'b', side: 'left' },
    style: 'straight',
    arrowEnd: true,
    stroke: '#000',
    strokeWidth: 2,
    label: '',
  };

  it('resolves connector endpoints from object sides and re-routes when they move', () => {
    expect(connectorPoints(connector, objects)).toEqual([
      { x: 100, y: 25 },
      { x: 300, y: 225 },
    ]);

    const moved = new Map(objects);
    moved.set('b', { ...b, x: 600 });

    expect(connectorPoints(connector, moved)?.[1]).toEqual({ x: 600, y: 225 });
    expect(connectorPoints({ ...connector, to: { objectId: 'gone', side: 'left' } }, objects)).toBeNull();
  });

  it('adds elbow waypoints for elbow connectors', () => {
    const points = connectorPoints({ ...connector, style: 'elbow' }, objects);

    expect(points).toHaveLength(4);
    expect(points?.[1]).toEqual({ x: 200, y: 25 });
    expect(points?.[2]).toEqual({ x: 200, y: 225 });
  });

  it('computes bounds for connectors, strokes and rotated boxes', () => {
    expect(connectorBounds(connector, objects)).toEqual({ x: 86, y: 11, w: 228, h: 228 });

    const stroke: StrokeObject = {
      id: 's',
      type: 'stroke',
      x: 10,
      y: 10,
      w: 0,
      h: 0,
      rotation: 0,
      z: 'a2',
      createdBy: 'u',
      createdAt: 0,
      color: '#000',
      size: 4,
      points: [
        [0, 0, 0.5],
        [50, 20, 0.5],
      ],
    };

    expect(objectBounds(stroke, objects)).toEqual({ x: 6, y: 6, w: 58, h: 28 });
    expect(objectBounds({ ...a, rotation: 90 }, objects).w).toBeCloseTo(50);
  });

  it('places eight handles around a box', () => {
    const handles = handlePositionsOf({ x: 0, y: 0, w: 100, h: 50 });

    expect(handles.map((handle) => handle.handle)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
    expect(handles.find((handle) => handle.handle === 'se')).toMatchObject({ x: 100, y: 50 });
  });
});
