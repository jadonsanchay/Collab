import { useEffect } from 'react';

import { socket } from '@/common/lib/socket';
import { useRoomStore } from '@/common/store/room.store';
import { useVectorStore } from '@/common/store/vector.store';
import { useViewportStore } from '@/common/store/viewport.store';

/** Matches the server's 10-per-second `viewport` budget. */
const BROADCAST_INTERVAL_MS = 100;

/**
 * Lets other users follow this client's pan/zoom. On a raster board the
 * viewport transform is sent; on a vector board the camera is, in the same
 * three numbers (`x`, `y`, `scale`), so followers on the same engine can
 * apply it directly.
 */
export const useViewportBroadcast = () => {
  useEffect(() => {
    let last = { x: NaN, y: NaN, scale: NaN };

    const interval = setInterval(() => {
      const vector = useRoomStore.getState().room.engine === 'vector';
      const current = vector
        ? (() => {
            const { camera } = useVectorStore.getState();

            return { x: camera.x, y: camera.y, scale: camera.zoom };
          })()
        : (() => {
            const { x, y, scale } = useViewportStore.getState();

            return { x, y, scale };
          })();

      if (current.x === last.x && current.y === last.y && current.scale === last.scale) return;

      last = current;
      socket.emit('viewport', current.x, current.y, current.scale);
    }, BROADCAST_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);
};
