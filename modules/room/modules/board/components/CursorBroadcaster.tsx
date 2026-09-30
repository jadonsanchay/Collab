import { useRef } from 'react';

import { motion } from 'framer-motion';
import { useInterval, useMouse } from 'react-use';

import { screenToBoardPoint, useBoardView } from '@/common/lib/boardCoords';
import { socket } from '@/common/lib/socket';

/** Matches the server's 30-per-second `cursor` budget. */
const BROADCAST_INTERVAL_MS = 33;

/**
 * Sends this pointer's board position to the room and shows its coordinates
 * by the cursor. Board coordinates come from whichever engine the room
 * uses, so remote cursors line up on raster and vector boards alike.
 */
const CursorBroadcaster = () => {
  // Re-render on view changes so the coordinate readout stays right.
  useBoardView();

  const prevPosition = useRef({ x: 0, y: 0 });

  const ref = useRef<HTMLDivElement>(null);

  const { docX, docY } = useMouse(ref as React.RefObject<Element>);

  const touchDevice = window.matchMedia('(pointer: coarse)').matches;

  useInterval(() => {
    if (
      (prevPosition.current.x !== docX || prevPosition.current.y !== docY) &&
      !touchDevice
    ) {
      const board = screenToBoardPoint(docX, docY);

      socket.emit('cursor', board.x, board.y);
      prevPosition.current = { x: docX, y: docY };
    }
  }, BROADCAST_INTERVAL_MS);

  if (touchDevice) return null;

  const board = screenToBoardPoint(docX, docY);

  return (
    <motion.div
      ref={ref}
      className="pointer-events-none absolute left-0 top-0 z-50 select-none transition-colors dark:text-white"
      animate={{ x: docX + 15, y: docY + 15 }}
      transition={{ duration: 0.05, ease: 'linear' }}
    >
      {board.x.toFixed(0)} | {board.y.toFixed(0)}
    </motion.div>
  );
};

export default CursorBroadcaster;
