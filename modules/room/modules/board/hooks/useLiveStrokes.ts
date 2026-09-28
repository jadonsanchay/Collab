import { useEffect, useRef } from 'react';

import { socket } from '@/common/lib/socket';
import { getStringFromRgba } from '@/common/lib/rgba';
import { LiveStroke, useLiveStrokesStore } from '@/common/store/liveStrokes.store';

import { drawCircle, drawRect } from '../helpers/Canvas.helpers';
import { useRemoteLiveCtx } from './useCtx';

/** If the committed move never arrives, the preview does not linger forever. */
const STROKE_TIMEOUT_MS = 2000;

const drawStroke = (ctx: CanvasRenderingContext2D, stroke: LiveStroke) => {
  const { options, points } = stroke;
  if (!points.length) return;

  ctx.lineWidth = options.lineWidth;
  ctx.strokeStyle = getStringFromRgba(options.lineColor);
  ctx.fillStyle = getStringFromRgba(options.fillColor);
  ctx.globalCompositeOperation =
    options.mode === 'eraser' ? 'destination-out' : 'source-over';

  const from = points[0];
  const to = points[points.length - 1];

  switch (options.shape) {
    case 'line': {
      ctx.beginPath();
      ctx.moveTo(from[0], from[1]);
      points.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.stroke();
      break;
    }

    case 'circle':
      drawCircle(ctx, from, to[0], to[1]);
      break;

    case 'rect':
      drawRect(ctx, from, to[0], to[1]);
      break;

    default:
      break;
  }
};

/**
 * Renders every other user's in-progress stroke on its own layer, separate
 * from the local preview in `useDraw` — both are transparent overlays, but
 * sharing one canvas would mean each side's per-frame clear-and-redraw wipes
 * out the other's content.
 */
export const useLiveStrokes = () => {
  const ctx = useRemoteLiveCtx();
  const start = useLiveStrokesStore((state) => state.start);
  const appendPoints = useLiveStrokesStore((state) => state.appendPoints);
  const remove = useLiveStrokesStore((state) => state.remove);

  const timeoutsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timeouts = timeoutsRef.current;

    const clearTimeoutFor = (strokeId: string) => {
      const existing = timeouts.get(strokeId);
      if (existing) clearTimeout(existing);
      timeouts.delete(strokeId);
    };

    socket.on('live_stroke_start', (userId, strokeId, options, from) => {
      clearTimeoutFor(strokeId);
      start(strokeId, userId, options, from);
    });

    socket.on('live_stroke_points', (_userId, strokeId, points) => {
      appendPoints(strokeId, points);
    });

    socket.on('live_stroke_end', (_userId, strokeId) => {
      clearTimeoutFor(strokeId);
      timeouts.set(
        strokeId,
        setTimeout(() => remove(strokeId), STROKE_TIMEOUT_MS),
      );
    });

    socket.on('user_draw', (move) => {
      clearTimeoutFor(move.clientId);
      remove(move.clientId);
    });

    return () => {
      socket.off('live_stroke_start');
      socket.off('live_stroke_points');
      socket.off('live_stroke_end');
      socket.off('user_draw');

      timeouts.forEach(clearTimeout);
      timeouts.clear();
    };
  }, [appendPoints, remove, start]);

  useEffect(() => {
    if (!ctx) return undefined;

    let rafId: number | null = null;

    const renderNow = () => {
      rafId = null;
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      useLiveStrokesStore
        .getState()
        .strokes.forEach((stroke) => drawStroke(ctx, stroke));
    };

    const scheduleRender = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(renderNow);
    };

    scheduleRender();
    const unsubscribe = useLiveStrokesStore.subscribe(scheduleRender);

    return () => {
      unsubscribe();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [ctx]);
};
