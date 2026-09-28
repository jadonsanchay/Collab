import { useEffect, useRef, useState } from 'react';

import { MousePointer2 } from 'lucide-react';

import { getMyUserId } from '@/common/lib/identity';
import { toScreen } from '@/common/lib/coords';
import { socket } from '@/common/lib/socket';
import { usePresenceStore } from '@/common/store/presence.store';
import { useRoom } from '@/common/store/room.store';
import { useViewportStore } from '@/common/store/viewport.store';

/** A cursor with no update in this long is assumed idle and hidden. */
const IDLE_TIMEOUT_MS = 5000;
const LERP_FACTOR = 0.35;

type RenderedCursor = { x: number; y: number };

/**
 * Renders every other user's cursor from a single rAF loop, lerping each
 * toward its last known position instead of snapping — smoother than the
 * 30-per-second update rate on its own would look.
 */
const CursorLayer = () => {
  const { users } = useRoom();
  const x = useViewportStore((state) => state.x);
  const y = useViewportStore((state) => state.y);
  const scale = useViewportStore((state) => state.scale);

  const [rendered, setRendered] = useState<Map<string, RenderedCursor>>(new Map());
  const [messages, setMessages] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const handleNewMsg = (userId: string, msg: string) => {
      setMessages((prev) => {
        const next = new Map(prev);
        next.set(userId, msg);
        return next;
      });

      setTimeout(() => {
        setMessages((prev) => {
          if (prev.get(userId) !== msg) return prev;
          const next = new Map(prev);
          next.delete(userId);
          return next;
        });
      }, 3000);
    };

    socket.on('new_msg', handleNewMsg);

    return () => {
      socket.off('new_msg', handleNewMsg);
    };
  }, []);

  const renderedRef = useRef(rendered);
  renderedRef.current = rendered;

  useEffect(() => {
    let rafId: number;

    const tick = () => {
      const { cursors } = usePresenceStore.getState();
      const now = Date.now();
      const next = new Map<string, RenderedCursor>();

      cursors.forEach((cursor, userId) => {
        if (now - cursor.lastUpdate > IDLE_TIMEOUT_MS) return;

        const prev = renderedRef.current.get(userId) ?? cursor;

        next.set(userId, {
          x: prev.x + (cursor.x - prev.x) * LERP_FACTOR,
          y: prev.y + (cursor.y - prev.y) * LERP_FACTOR,
        });
      });

      setRendered(next);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, []);

  const myUserId = getMyUserId();

  return (
    <>
      {[...rendered.entries()].map(([userId, pos]) => {
        if (userId === myUserId) return null;

        const user = users.get(userId);
        const msg = messages.get(userId);

        return (
          <div
            key={userId}
            className="pointer-events-none absolute left-0 top-0 z-20 text-blue-800"
            style={{
              color: user?.color,
              transform: `translate(${toScreen(pos.x, x, scale)}px, ${toScreen(pos.y, y, scale)}px)`,
            }}
          >
            <MousePointer2 />
            {msg && (
              <p className="absolute left-5 top-full max-h-20 max-w-60 overflow-hidden text-ellipsis rounded-md bg-zinc-900 p-1 px-3 text-white">
                {msg}
              </p>
            )}
            <p className="ml-2">{user?.name || 'Anonymous'}</p>
          </div>
        );
      })}
    </>
  );
};

export default CursorLayer;
