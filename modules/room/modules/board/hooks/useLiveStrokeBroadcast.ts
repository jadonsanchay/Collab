import { useRef } from 'react';

import { socket } from '@/common/lib/socket';
import { CtxOptions, Point } from '@/common/types/global';

/**
 * Batches points once per animation frame rather than emitting on every
 * pointer move, so a fast drawer on a high-polling-rate mouse does not turn
 * into a socket flood.
 */
export const useLiveStrokeBroadcast = () => {
  const strokeIdRef = useRef<string | null>(null);
  const bufferRef = useRef<Point[]>([]);
  const rafRef = useRef<number | null>(null);

  const flush = () => {
    rafRef.current = null;

    if (!strokeIdRef.current || !bufferRef.current.length) return;

    const points = bufferRef.current;
    bufferRef.current = [];

    socket.emit('stroke_points', strokeIdRef.current, points);
  };

  const start = (strokeId: string, options: CtxOptions, from: Point) => {
    strokeIdRef.current = strokeId;
    bufferRef.current = [];

    socket.emit('stroke_start', strokeId, options, from);
  };

  const addPoint = (point: Point) => {
    if (!strokeIdRef.current) return;

    bufferRef.current.push(point);

    if (rafRef.current === null) rafRef.current = requestAnimationFrame(flush);
  };

  const end = () => {
    if (!strokeIdRef.current) return;

    flush();
    socket.emit('stroke_end', strokeIdRef.current);
    strokeIdRef.current = null;
  };

  return { start, addPoint, end };
};
