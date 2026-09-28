import { useEffect } from 'react';

import { toast } from 'sonner';

import { socket } from '@/common/lib/socket';
import { usePresenceStore } from '@/common/store/presence.store';
import { useRoom } from '@/common/store/room.store';
import { useViewportStore } from '@/common/store/viewport.store';

/**
 * Keeps `presence.store` in sync with the room's cursor/viewport broadcasts,
 * applies a followed user's viewport locally, and cleans up a user's
 * presence entries once they are gone for good (not just offline — their
 * cursor/viewport are still meaningful during the reconnect grace window).
 */
export const usePresenceSync = () => {
  const { users } = useRoom();

  useEffect(() => {
    const handleCursorMoved = (userId: string, x: number, y: number) => {
      usePresenceStore.getState().setCursor(userId, x, y);
    };

    const handleViewportChanged = (
      userId: string,
      x: number,
      y: number,
      scale: number,
    ) => {
      usePresenceStore.getState().setViewport(userId, x, y, scale);

      if (usePresenceStore.getState().following === userId) {
        useViewportStore.setState({ x, y, scale });
      }
    };

    const handleSummoned = (byUserId: string) => {
      const name = users.get(byUserId)?.name || 'Someone';

      toast(
        <div className="flex items-center justify-between gap-3">
          <span>{name} wants everyone to see this.</span>
          <button
            type="button"
            className="rounded-md bg-zinc-900 px-2 py-1 text-white"
            onClick={() => usePresenceStore.getState().setFollowing(byUserId)}
          >
            Follow
          </button>
        </div>,
        { duration: 8000 },
      );
    };

    const handleUserDisconnected = (userId: string) => {
      usePresenceStore.getState().removeUser(userId);
    };

    // Named handlers, not the bare `socket.off(event)` form: `user_disconnected`
    // also has a listener in Room.context.tsx, which a bare `.off` would strip.
    socket.on('cursor_moved', handleCursorMoved);
    socket.on('viewport_changed', handleViewportChanged);
    socket.on('summoned', handleSummoned);
    socket.on('user_disconnected', handleUserDisconnected);

    return () => {
      socket.off('cursor_moved', handleCursorMoved);
      socket.off('viewport_changed', handleViewportChanged);
      socket.off('summoned', handleSummoned);
      socket.off('user_disconnected', handleUserDisconnected);
    };
  }, [users]);
};
