import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import { makeMove } from '@/server/testing/fixtures';

import { drawMove } from './drawMove';

/**
 * Real pixels, via a Node canvas. jsdom has no rasteriser, so a fake context
 * could only check which calls were made; this checks what ended up drawn.
 */
const makeCtx = (width = 200, height = 120) =>
  createCanvas(width, height).getContext('2d') as unknown as CanvasRenderingContext2D;

const opaquePixels = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  const { data } = ctx.getImageData(x, y, width, height);
  let count = 0;

  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) count += 1;
  }

  return count;
};

const black = { r: 0, g: 0, b: 0, a: 1 };

const textMove = (content: string, fontSize = 24) =>
  makeMove({
    path: [[10, 10]],
    text: { content, fontSize },
    options: { ...makeMove().options, shape: 'text', lineColor: black },
  });

describe('drawMove text', () => {
  it('renders a text move as non-transparent pixels at its anchor', () => {
    const ctx = makeCtx();

    drawMove(ctx, textMove('Hello'), new Map());

    expect(opaquePixels(ctx, 10, 10, 90, 30)).toBeGreaterThan(0);
    // Nothing lands far away from the anchor.
    expect(opaquePixels(ctx, 120, 80, 60, 30)).toBe(0);
  });

  it('draws each line below the previous one', () => {
    const ctx = makeCtx();

    drawMove(ctx, textMove('Top\nBottom', 24), new Map());

    // Second line starts one line height (24 * 1.25 = 30px) below the first.
    expect(opaquePixels(ctx, 10, 40, 100, 30)).toBeGreaterThan(0);
  });

  it('uses the line colour, not the fill colour', () => {
    const ctx = makeCtx();
    const move = textMove('Red');
    move.options.lineColor = { r: 255, g: 0, b: 0, a: 1 };
    move.options.fillColor = { r: 0, g: 0, b: 255, a: 1 };

    drawMove(ctx, move, new Map());

    const { data } = ctx.getImageData(10, 10, 60, 30);
    let red = 0;
    let blue = 0;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) {
        if (data[i] > data[i + 2]) red += 1;
        else blue += 1;
      }
    }

    expect(red).toBeGreaterThan(0);
    expect(blue).toBe(0);
  });

  it('draws nothing for a text move without a text payload', () => {
    const ctx = makeCtx();
    const move = textMove('ignored');
    delete move.text;

    drawMove(ctx, move, new Map());

    expect(opaquePixels(ctx, 0, 0, 200, 120)).toBe(0);
  });
});
