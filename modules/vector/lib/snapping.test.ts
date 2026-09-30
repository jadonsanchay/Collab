import { describe, expect, it } from 'vitest';

import { snapRect } from './snapping';

describe('snapRect', () => {
  const others = [{ x: 100, y: 100, w: 200, h: 100 }];

  it('snaps a near edge to an edge and reports the guide', () => {
    const result = snapRect({ x: 303, y: 400, w: 50, h: 50 }, others, 8);

    expect(result.dx).toBe(-3);
    expect(result.guides.x).toEqual([300]);
    expect(result.dy).toBe(0);
    expect(result.guides.y).toEqual([]);
  });

  it('snaps centres to centres', () => {
    const result = snapRect({ x: 180, y: 144, w: 40, h: 20 }, others, 8);

    // Moving centre x 200 vs other centre 200; y centre 154 vs 150.
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(-4);
    expect(result.guides.y).toEqual([150]);
  });

  it('prefers the closest candidate and ignores far ones', () => {
    // Left edge 96 is 4 from 100; the centre (116) and right edge (136) are too far.
    const result = snapRect({ x: 96, y: 500, w: 40, h: 10 }, others, 8);

    expect(result.dx).toBe(4);
    expect(snapRect({ x: 500, y: 500, w: 10, h: 10 }, others, 8)).toEqual({ dx: 0, dy: 0, guides: { x: [], y: [] } });
  });
});
