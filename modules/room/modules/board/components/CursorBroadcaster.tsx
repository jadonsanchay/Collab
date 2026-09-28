import { useRef } from 'react';

import { motion } from 'framer-motion';
import { useInterval, useMouse } from 'react-use';

import { toBoard } from '@/common/lib/coords';
import { socket } from '@/common/lib/socket';
import { useViewportStore } from '@/common/store/viewport.store';

/** Matches the server's 30-per-second `cursor` budget. */
const BROADCAST_INTERVAL_MS = 33;

const CursorBroadcaster = () => {
  const x = useViewportStore((state) => state.x);
  const y = useViewportStore((state) => state.y);
  const scale = useViewportStore((state) => state.scale);

  const prevPosition = useRef({ x: 0, y: 0 });

  const ref = useRef<HTMLDivElement>(null);

  const { docX, docY } = useMouse(ref as React.RefObject<Element>);

  const touchDevice = window.matchMedia('(pointer: coarse)').matches;

  useInterval(() => {
    if (
      (prevPosition.current.x !== docX || prevPosition.current.y !== docY) &&
      !touchDevice
    ) {
      socket.emit('cursor', toBoard(docX, x, scale), toBoard(docY, y, scale));
      prevPosition.current = { x: docX, y: docY };
    }
  }, BROADCAST_INTERVAL_MS);

  if (touchDevice) return null;

  return (
    <motion.div
      ref={ref}
      className="pointer-events-none absolute left-0 top-0 z-50 select-none transition-colors dark:text-white"
      animate={{ x: docX + 15, y: docY + 15 }}
      transition={{ duration: 0.05, ease: 'linear' }}
    >
      {toBoard(docX, x, scale).toFixed(0)} | {toBoard(docY, y, scale).toFixed(0)}
    </motion.div>
  );
};

export default CursorBroadcaster;
