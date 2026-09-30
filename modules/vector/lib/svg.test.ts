import { describe, expect, it } from 'vitest';

import { newConnector, newFrame, newShape, newSticky, newStroke, newText } from '@/common/vector/objects';
import type { BoardObject } from '@/common/vector/types';

import { contentBoundsOf, toSvg } from './svg';

const common = { z: 'a0', createdBy: 'alice', now: 1 };

const byNewline = (text: string) => text.split('\n');

describe('toSvg', () => {
  const a = newShape('rect', { x: 100, y: 100 }, { x: 300, y: 200 }, { stroke: '#000000', fill: '#FFEEAA', strokeWidth: 3 }, common);
  const b = { ...newShape('ellipse', { x: 500, y: 100 }, { x: 700, y: 250 }, { stroke: '#123456', fill: null, strokeWidth: 2 }, { ...common, z: 'a1' }), text: 'Two <b>' };
  const objects: BoardObject[] = [
    a,
    b,
    newStroke([[10, 10, 0.5], [60, 40, 0.5], [120, 30, 0.5]], { color: 'rgba(0, 0, 0, 1)', size: 6 }, { ...common, z: 'a2' }),
    { ...newText({ x: 100, y: 400 }, { color: '#222222', fontSize: 24 }, { ...common, z: 'a3' }), text: 'Hello\nworld' },
    { ...newSticky({ x: 900, y: 200 }, '#FEF08A', { ...common, z: 'a4' }), text: 'note' },
    newConnector({ objectId: a.id, side: 'right' }, { objectId: b.id, side: 'left' }, { stroke: '#FF0000', strokeWidth: 2 }, { ...common, z: 'a5' }),
    newFrame({ x: 0, y: 0 }, { x: 1200, y: 600 }, { ...common, z: 'Z' }),
    {
      id: 'img',
      type: 'image',
      x: 50,
      y: 500,
      w: 120,
      h: 80,
      rotation: 0,
      z: 'a6',
      createdBy: 'alice',
      createdAt: 1,
      url: '/uploads/a.png',
      naturalW: 120,
      naturalH: 80,
    },
  ];

  it('serialises every object type into one document sized to the content', () => {
    const svg = toSvg(objects, { wrap: byNewline, padding: 10 });

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('<rect x="0" y="0" width="200" height="100"');
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('Two &lt;b&gt;');
    expect(svg).toContain('<path d="M');
    expect(svg).toContain('>Hello</text>');
    expect(svg).toContain('>world</text>');
    expect(svg).toContain('fill="#FEF08A"');
    expect(svg).toContain('<polyline');
    expect(svg).toContain('stroke-dasharray');
    expect(svg).toContain('<image href="/uploads/a.png"');

    // The frame is the outermost thing; the viewBox wraps it plus padding.
    const bounds = contentBoundsOf(objects, 10);
    expect(bounds).toMatchObject({ x: -10, y: -10 });
    expect(svg).toContain(`viewBox="-10 -10 ${bounds?.w} ${bounds?.h}"`);
  });

  it('draws in z order so later objects paint on top', () => {
    const svg = toSvg([b, a], { wrap: byNewline });

    expect(svg.indexOf('<rect')).toBeLessThan(svg.indexOf('<ellipse'));
  });

  it('gives an empty board a small empty canvas', () => {
    expect(toSvg([], { wrap: byNewline })).toContain('viewBox="0 0 100 100"');
  });
});
