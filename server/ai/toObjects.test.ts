import { describe, expect, it } from 'vitest';

import { byZ } from '@/common/vector/order';

import { fakePrograms } from './fakeAgent';
import { placeTargetUnbounded, toObjects } from './toObjects';

const target = { x: -500, y: -300, width: 600, height: 400 };

describe('toObjects', () => {
  it('turns every primitive of a program into an object inside the target, in order', () => {
    const planned = toObjects(fakePrograms.draw('a house'), target, {
      createdBy: 'ai',
      requestId: 'req-1',
      firstZ: 'a0',
      now: 1,
    });

    expect(planned.map((item) => item.object.type)).toEqual(['shape', 'stroke', 'shape', 'text', 'shape']);
    expect(planned.map((item) => (item.object.type === 'shape' ? item.object.kind : null))).toEqual([
      'rect',
      null,
      'rect',
      null,
      'arrow',
    ]);

    // Stamped for "Undo Sketch", stacked in program order.
    planned.forEach((item) => expect(item.object.meta).toEqual({ requestId: 'req-1' }));
    const sorted = [...planned.map((item) => item.object)].sort(byZ);
    expect(sorted.map((object) => object.id)).toEqual(planned.map((item) => item.object.id));

    // Inside the target, with a margin for line widths.
    planned.forEach(({ object }) => {
      const left = Math.min(object.x, object.x + object.w);
      const top = Math.min(object.y, object.y + object.h);
      const right = Math.max(object.x, object.x + object.w);
      const bottom = Math.max(object.y, object.y + object.h);

      expect(left).toBeGreaterThanOrEqual(target.x - 10);
      expect(top).toBeGreaterThanOrEqual(target.y - 10);
      expect(right).toBeLessThanOrEqual(target.x + target.width + 10);
      expect(bottom).toBeLessThanOrEqual(target.y + target.height + 10);
    });

    // Each object is animated for a bounded time.
    planned.forEach((item) => {
      expect(item.cursorPath.length).toBeGreaterThan(1);
      expect(item.durationMs).toBeGreaterThan(0);
      expect(item.durationMs).toBeLessThanOrEqual(4000);
    });
  });

  it('keeps text and sticky content, sizing text to its longest line', () => {
    const [sticky] = toObjects(fakePrograms.summarize(), target, { createdBy: 'ai', firstZ: 'a0' });
    const [, , , text] = toObjects(fakePrograms.draw('lighthouse'), target, { createdBy: 'ai', firstZ: 'a0' });

    expect(sticky.object).toMatchObject({ type: 'sticky', text: 'Key point one from the board', fill: '#FEF08A' });
    expect(text.object).toMatchObject({ type: 'text', text: 'lighthouse' });
    expect(text.object.w).toBeGreaterThan(text.object.h);
    expect(text.object.meta).toBeUndefined();
  });

  it('shortens every animation pro rata when the whole program would run too long', () => {
    const slow = toObjects(fakePrograms.draw(), target, { createdBy: 'ai', firstZ: 'a0' }, { maxTotalMs: 1000 });
    const total = slow.reduce((sum, item) => sum + item.durationMs, 0);

    expect(total).toBeLessThanOrEqual(1000.001);
  });
});

describe('placeTargetUnbounded', () => {
  const viewport = { x: -2000, y: -1500, width: 1200, height: 800 };

  it('centres a drawing in the viewport without clamping negative coordinates', () => {
    const placed = placeTargetUnbounded('draw', { viewport });

    expect(placed).toEqual({ x: -2000 + 240, y: -1500 + 160, width: 720, height: 480 });
  });

  it('puts a clean-up beside its selection and needs one', () => {
    expect(placeTargetUnbounded('cleanup', { viewport })).toBeNull();
    expect(
      placeTargetUnbounded('cleanup', { viewport, selection: { x: -100, y: -50, width: 200, height: 100 } }),
    ).toEqual({ x: 140, y: -50, width: 200, height: 100 });
  });

  it('stacks a summary from the viewport corner', () => {
    expect(placeTargetUnbounded('summarize', { viewport })).toEqual({
      x: -1976,
      y: -1476,
      width: 720,
      height: 480,
    });
  });
});
