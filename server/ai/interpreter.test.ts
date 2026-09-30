import { describe, expect, it } from 'vitest';

import { CANVAS_SIZE } from '@/common/constants/canvasSize';
import { drawPayloadSchema } from '@/common/schemas/move';

import {
  DEFAULT_TIMING,
  hexToRgba,
  interpret,
  normalizeRect,
  placeTarget,
  wrapText,
} from './interpreter';
import {
  drawingProgramSchema,
  MAX_PRIMITIVES,
  type DrawingProgram,
  type Primitive,
} from './schema';

const board = CANVAS_SIZE;

const program = (primitives: Primitive[], note?: string): DrawingProgram => ({
  primitives,
  ...(note ? { note } : {}),
});

describe('interpret: scaling and placement', () => {
  it('fits the program square inside the target, centred along the long axis', () => {
    const target = { x: 100, y: 50, width: 400, height: 200 };
    const [move] = interpret(
      program([{ type: 'rect', x: 0, y: 0, w: 1000, h: 1000, stroke: '#000000', fill: null, width: 5 }]),
      target,
    );

    // scale = 200 / 1000 = 0.2, so the square is 200 wide, centred in 400.
    expect(move.payload.path[0]).toEqual([200, 50]);
    expect(move.payload.rect).toEqual({ width: 200, height: 200 });
    expect(move.payload.options.shape).toBe('rect');
    expect(move.payload.options.lineWidth).toBe(1);
  });

  it('clamps every coordinate to the board', () => {
    const target = { x: 3900, y: 1900, width: 400, height: 400 };
    const moves = interpret(
      program([
        {
          type: 'line',
          points: [
            { x: 0, y: 0 },
            { x: 1000, y: 1000 },
          ],
          stroke: '#ff0000',
          width: 3,
        },
      ]),
      target,
    );

    moves.forEach((move) => {
      move.payload.path.forEach(([x, y]) => {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(board.width);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(board.height);
      });
    });
  });

  it('accepts a target drawn from bottom-right to top-left', () => {
    const forward = interpret(
      program([{ type: 'text', x: 0, y: 0, text: 'hi', size: 40, color: '#000000' }]),
      { x: 100, y: 100, width: 300, height: 300 },
    );
    const backward = interpret(
      program([{ type: 'text', x: 0, y: 0, text: 'hi', size: 40, color: '#000000' }]),
      { x: 400, y: 400, width: -300, height: -300 },
    );

    expect(backward[0].payload.path).toEqual(forward[0].payload.path);
  });
});

describe('interpret: primitives', () => {
  const target = { x: 0, y: 0, width: 1000, height: 1000 };

  it('turns an arrow into a shaft and a three-point head whose middle is the tip', () => {
    const moves = interpret(
      program([{ type: 'arrow', from: { x: 100, y: 500 }, to: { x: 900, y: 500 }, stroke: '#123456', width: 4 }]),
      target,
    );

    expect(moves).toHaveLength(2);

    const [shaft, head] = moves;

    expect(shaft.payload.path).toEqual([
      [100, 500],
      [900, 500],
    ]);
    expect(head.payload.path).toHaveLength(3);
    expect(head.payload.path[1]).toEqual([900, 500]);
    // Wings point back along the shaft.
    expect(head.payload.path[0][0]).toBeLessThan(900);
    expect(head.payload.path[2][0]).toBeLessThan(900);
    expect(shaft.payload.options.lineColor).toEqual(hexToRgba('#123456'));
  });

  it('turns an ellipse into a circle move with scaled radii', () => {
    const [move] = interpret(
      program([{ type: 'ellipse', cx: 500, cy: 500, rx: 200, ry: 100, stroke: '#000000', fill: '#00ff00', width: 2 }]),
      { x: 0, y: 0, width: 500, height: 500 },
    );

    expect(move.payload.options.shape).toBe('circle');
    expect(move.payload.circle).toEqual({ cX: 250, cY: 250, radiusX: 100, radiusY: 50 });
    expect(move.payload.options.fillColor).toEqual({ r: 0, g: 255, b: 0, a: 1 });
    expect(move.cursorPath.length).toBeGreaterThan(8);
  });

  it('scales text size, never below the readable minimum', () => {
    const [big] = interpret(
      program([{ type: 'text', x: 0, y: 0, text: 'Title', size: 60, color: '#000000' }]),
      target,
    );
    const [tiny] = interpret(
      program([{ type: 'text', x: 0, y: 0, text: 'Title', size: 8, color: '#000000' }]),
      { x: 0, y: 0, width: 100, height: 100 },
    );

    expect(big.payload.options.shape).toBe('text');
    expect(big.payload.text).toEqual({ content: 'Title', fontSize: 60 });
    expect(tiny.payload.text?.fontSize).toBe(8);
  });

  it('turns a sticky into a filled rect plus wrapped text inside it', () => {
    const moves = interpret(
      program([{ type: 'sticky', x: 100, y: 100, w: 300, h: 300, text: 'one two three four five six seven', fill: '#fef08a' }]),
      target,
    );

    expect(moves).toHaveLength(2);

    const [note, text] = moves;

    expect(note.payload.options.shape).toBe('rect');
    expect(note.payload.options.fillColor).toEqual(hexToRgba('#fef08a'));
    expect(text.payload.options.shape).toBe('text');
    expect(text.payload.text?.content.split('\n').length).toBeGreaterThan(1);
    // Text sits inside the note.
    expect(text.payload.path[0][0]).toBeGreaterThan(100);
    expect(text.payload.path[0][1]).toBeGreaterThan(100);
  });

  it('every payload passes the same schema the server applies to human moves', () => {
    const moves = interpret(
      program([
        { type: 'line', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], stroke: '#000000', width: 1 },
        { type: 'rect', x: 10, y: 10, w: 100, h: 100, stroke: '#000000', fill: null, width: 20 },
        { type: 'sticky', x: 0, y: 0, w: 50, h: 50, text: 'x', fill: '#ffffff' },
      ]),
      target,
    );

    moves.forEach((move) => {
      expect(drawPayloadSchema.safeParse(move.payload).success).toBe(true);
    });
  });
});

describe('interpret: timing', () => {
  const target = { x: 0, y: 0, width: 4000, height: 2000 };

  it('clamps each move between the minimum and maximum duration', () => {
    const moves = interpret(
      program([
        { type: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], stroke: '#000000', width: 1 },
        { type: 'line', points: [{ x: 0, y: 0 }, { x: 1000, y: 1000 }], stroke: '#000000', width: 1 },
      ]),
      target,
    );

    expect(moves[0].durationMs).toBe(DEFAULT_TIMING.minMoveMs);
    expect(moves[1].durationMs).toBe(DEFAULT_TIMING.maxMoveMs);
  });

  it('shortens every move pro rata when the whole program would run too long', () => {
    const lines: Primitive[] = Array.from({ length: 20 }, () => ({
      type: 'line' as const,
      points: [{ x: 0, y: 0 }, { x: 1000, y: 1000 }],
      stroke: '#000000',
      width: 1,
    }));

    const moves = interpret(program(lines), target);
    const total = moves.reduce((sum, move) => sum + move.durationMs, 0);

    expect(total).toBeCloseTo(DEFAULT_TIMING.maxTotalMs, 3);
    expect(moves.every((move) => move.durationMs < DEFAULT_TIMING.maxMoveMs)).toBe(true);
  });
});

describe('program schema', () => {
  it('rejects more than the primitive cap', () => {
    const tooMany: Primitive[] = Array.from({ length: MAX_PRIMITIVES + 1 }, () => ({
      type: 'text' as const,
      x: 0,
      y: 0,
      text: 'x',
      size: 10,
      color: '#000000',
    }));

    expect(drawingProgramSchema.safeParse({ primitives: tooMany }).success).toBe(false);
    expect(
      drawingProgramSchema.safeParse({ primitives: tooMany.slice(0, MAX_PRIMITIVES) }).success,
    ).toBe(true);
  });

  it('rejects colours that are not six-digit hex and coordinates outside the space', () => {
    expect(
      drawingProgramSchema.safeParse({
        primitives: [{ type: 'text', x: 0, y: 0, text: 'x', size: 10, color: 'red' }],
      }).success,
    ).toBe(false);
    expect(
      drawingProgramSchema.safeParse({
        primitives: [{ type: 'text', x: 1001, y: 0, text: 'x', size: 10, color: '#000000' }],
      }).success,
    ).toBe(false);
  });
});

describe('interpret: random programs stay on the board', () => {
  // A small seeded generator so a failure reproduces.
  let seed = 20260930;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;

    return seed / 2 ** 32;
  };
  const between = (low: number, high: number) => low + random() * (high - low);
  const hex = () => `#${Math.floor(random() * 0xffffff).toString(16).padStart(6, '0')}`;
  const point = () => ({ x: between(0, 1000), y: between(0, 1000) });

  const randomPrimitive = (): Primitive => {
    const pick = Math.floor(random() * 6);

    switch (pick) {
      case 0:
        return {
          type: 'line',
          points: Array.from({ length: 2 + Math.floor(random() * 20) }, point),
          stroke: hex(),
          width: between(1, 20),
        };
      case 1:
        return { type: 'rect', ...point(), w: between(0, 1000), h: between(0, 1000), stroke: hex(), fill: random() > 0.5 ? hex() : null, width: between(1, 20) };
      case 2:
        return { type: 'ellipse', cx: between(0, 1000), cy: between(0, 1000), rx: between(0, 1000), ry: between(0, 1000), stroke: hex(), fill: null, width: between(1, 20) };
      case 3:
        return { type: 'arrow', from: point(), to: point(), stroke: hex(), width: between(1, 20) };
      case 4:
        return { type: 'text', ...point(), text: 'lorem ipsum dolor sit amet', size: between(8, 120), color: hex() };
      default:
        return { type: 'sticky', ...point(), w: between(0, 1000), h: between(0, 1000), text: 'a sticky with several words in it to wrap', fill: hex() };
    }
  };

  it('never emits an out-of-board coordinate or more moves than two per primitive', () => {
    for (let run = 0; run < 150; run += 1) {
      const count = 1 + Math.floor(random() * MAX_PRIMITIVES);
      const primitives = Array.from({ length: count }, randomPrimitive);
      const target = {
        x: between(-500, 4500),
        y: between(-500, 2500),
        width: between(-3000, 3000),
        height: between(-2000, 2000),
      };

      const parsed = drawingProgramSchema.safeParse({ primitives });
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      const moves = interpret(parsed.data, target);

      expect(moves.length).toBeLessThanOrEqual(count * 2);

      moves.forEach((move) => {
        expect(drawPayloadSchema.safeParse(move.payload).success).toBe(true);
        expect(move.durationMs).toBeGreaterThan(0);

        [...move.payload.path, ...move.cursorPath].forEach(([x, y]) => {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(board.width);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(board.height);
        });
      });
    }
  });
});

describe('placeTarget', () => {
  const viewport = { x: 1000, y: 500, width: 1200, height: 800 };

  it('needs a selection for cleanup and puts the result to its right', () => {
    expect(placeTarget('cleanup', { viewport })).toBeNull();

    const selection = { x: 200, y: 300, width: 400, height: 250 };

    expect(placeTarget('cleanup', { viewport, selection })).toEqual({
      x: 640,
      y: 300,
      width: 400,
      height: 250,
    });
  });

  it('shifts a cleanup target left when it would leave the board', () => {
    const selection = { x: 3700, y: 300, width: 250, height: 200 };
    const target = placeTarget('cleanup', { viewport, selection });

    expect(target).not.toBeNull();
    expect((target?.x ?? 0) + (target?.width ?? 0)).toBeLessThanOrEqual(board.width);
  });

  it('centres a draw target at sixty percent of the viewport', () => {
    expect(placeTarget('draw', { viewport })).toEqual({
      x: 1000 + (1200 - 720) / 2,
      y: 500 + (800 - 480) / 2,
      width: 720,
      height: 480,
    });
  });

  it('places a summary at the top-left of the viewport with a margin', () => {
    const target = placeTarget('summarize', { viewport });

    expect(target?.x).toBe(1024);
    expect(target?.y).toBe(524);
    expect(target?.width).toBeLessThanOrEqual(720);
  });
});

describe('helpers', () => {
  it('normalizes rectangles with negative sizes', () => {
    expect(normalizeRect({ x: 10, y: 10, width: -5, height: -3 })).toEqual({
      x: 5,
      y: 7,
      width: 5,
      height: 3,
    });
  });

  it('wraps words greedily and breaks words longer than a line', () => {
    expect(wrapText('one two three', 7)).toEqual(['one two', 'three']);
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapText('', 4)).toEqual([]);
  });

  it('parses hex colours', () => {
    expect(hexToRgba('#FF8000')).toEqual({ r: 255, g: 128, b: 0, a: 1 });
  });
});
