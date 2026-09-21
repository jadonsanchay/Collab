import type { Move } from '@/common/types/global';

/**
 * A minimal valid `Move`, shared by the unit and integration tests so neither
 * has to restate the whole shape. `id` and `timestamp` are left empty because
 * the server assigns both.
 */
export const makeMove = (overrides: Partial<Move> = {}): Move => ({
  circle: { cX: 0, cY: 0, radiusX: 0, radiusY: 0 },
  rect: { width: 0, height: 0 },
  img: { base64: '' },
  path: [
    [0, 0],
    [10, 10],
  ],
  options: {
    lineWidth: 2,
    lineColor: { r: 0, g: 0, b: 0, a: 1 },
    fillColor: { r: 0, g: 0, b: 0, a: 0 },
    shape: 'line',
    mode: 'draw',
    selection: null,
  },
  timestamp: 0,
  id: '',
  ...overrides,
});
