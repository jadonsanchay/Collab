import { describe, expect, it } from 'vitest';

import { CANVAS_SIZE } from '@/common/constants/canvasSize';

import { clipToBoard } from './captureBoard';

describe('clipToBoard', () => {
  it('normalises a rectangle dragged up and to the left', () => {
    expect(clipToBoard({ x: 300, y: 200, width: -100, height: -50 })).toEqual({
      x: 200,
      y: 150,
      width: 100,
      height: 50,
    });
  });

  it('clips to the board edges', () => {
    expect(clipToBoard({ x: -50, y: -50, width: 200, height: 200 })).toEqual({
      x: 0,
      y: 0,
      width: 150,
      height: 150,
    });
    expect(clipToBoard({ x: 3900, y: 1900, width: 500, height: 500 })).toEqual({
      x: 3900,
      y: 1900,
      width: CANVAS_SIZE.width - 3900,
      height: CANVAS_SIZE.height - 1900,
    });
  });

  it('collapses a rectangle entirely off the board to zero size', () => {
    expect(clipToBoard({ x: 5000, y: 100, width: 10, height: 10 }).width).toBe(0);
  });
});
