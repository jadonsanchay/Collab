import { useEffect } from 'react';

import { socket } from '@/common/lib/socket';
import { useViewportStore } from '@/common/store/viewport.store';

/** Matches the server's 10-per-second `viewport` budget. */
const BROADCAST_INTERVAL_MS = 100;

/** Lets other users follow this client's pan/zoom. */
export const useViewportBroadcast = () => {
  useEffect(() => {
    let last = { x: NaN, y: NaN, scale: NaN };

    const interval = setInterval(() => {
      const { x, y, scale } = useViewportStore.getState();

      if (x === last.x && y === last.y && scale === last.scale) return;

      last = { x, y, scale };
      socket.emit('viewport', x, y, scale);
    }, BROADCAST_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);
};
