import { describe, expect, it } from 'vitest';

import { bottomZ, byZ, topZ, zStep } from './order';
import type { BoardObject } from './types';

const object = (id: string, z: string): BoardObject =>
  ({ id, z, type: 'frame', x: 0, y: 0, w: 1, h: 1, rotation: 0, createdBy: 'u', createdAt: 0, title: '' }) as BoardObject;

describe('z ordering', () => {
  it('generates keys above and below everything present', () => {
    const objects = [object('a', 'a0'), object('b', 'a1')];

    expect(topZ(objects) > 'a1').toBe(true);
    expect(bottomZ(objects) < 'a0').toBe(true);
    expect(typeof topZ([])).toBe('string');
  });

  it('moves one object a step up or down without touching the others', () => {
    const objects = [object('a', 'a0'), object('b', 'a1'), object('c', 'a2')];

    const up = zStep(objects, 'a', 'up');
    expect(up).not.toBeNull();
    expect([...objects.map((o) => (o.id === 'a' ? { ...o, z: up as string } : o))].sort(byZ).map((o) => o.id)).toEqual(['b', 'a', 'c']);

    const down = zStep(objects, 'c', 'down');
    expect([...objects.map((o) => (o.id === 'c' ? { ...o, z: down as string } : o))].sort(byZ).map((o) => o.id)).toEqual(['a', 'c', 'b']);

    expect(zStep(objects, 'c', 'up')).toBeNull();
    expect(zStep(objects, 'a', 'down')).toBeNull();
    expect(zStep(objects, 'missing', 'up')).toBeNull();
  });
});
