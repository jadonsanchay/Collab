import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiStore } from '@/common/store/ai.store';
import { useViewportStore } from '@/common/store/viewport.store';

const emit = vi.fn();

vi.mock('@/common/lib/socket', () => ({
  socket: { emit: (...args: unknown[]) => emit(...args), on: () => undefined, off: () => undefined },
}));

const { currentViewportRect, parseSketchMention, requestSketch, undoSketch } = await import('./ai');

describe('parseSketchMention', () => {
  it('extracts the prompt after an @sketch mention, case-insensitively', () => {
    expect(parseSketchMention('@sketch draw a box')).toBe('draw a box');
    expect(parseSketchMention('  @Sketch: a boat ')).toBe('a boat');
    expect(parseSketchMention('@sketch')).toBe('');
  });

  it('returns null for ordinary messages and near misses', () => {
    expect(parseSketchMention('hello @sketch')).toBeNull();
    expect(parseSketchMention('@sketchy idea')).toBeNull();
    expect(parseSketchMention('sketch this')).toBeNull();
  });
});

describe('requestSketch', () => {
  beforeEach(() => {
    emit.mockClear();
    useAiStore.setState({ requests: new Map(), mine: new Set(), promptOpen: false });
    useViewportStore.setState({ x: -100, y: -50, scale: 2 });
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 });
  });

  it('derives the visible board rectangle from the viewport transform', () => {
    expect(currentViewportRect()).toEqual({ x: 50, y: 25, width: 400, height: 300 });
  });

  it('remembers the request as ours and emits only the keys that are set', () => {
    const requestId = requestSketch('draw', { prompt: 'a kite', image: undefined });

    expect(useAiStore.getState().mine.has(requestId)).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);

    const [event, payload] = emit.mock.calls[0];

    expect(event).toBe('ai_request');
    expect(payload).toEqual({
      requestId,
      kind: 'draw',
      prompt: 'a kite',
      viewport: { x: 50, y: 25, width: 400, height: 300 },
    });
    expect('image' in payload).toBe(false);
  });

  it('sends the selection and image for a cleanup', () => {
    const selection = { x: 1, y: 2, width: 3, height: 4 };

    requestSketch('cleanup', { selection, image: 'aGk=' });

    expect(emit.mock.calls[0][1]).toMatchObject({ kind: 'cleanup', selection, image: 'aGk=' });
  });

  it('emits ai_undo for a request id', () => {
    undoSketch('abc');

    expect(emit).toHaveBeenCalledWith('ai_undo', 'abc');
  });
});
