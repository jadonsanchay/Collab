import { useEffect } from 'react';

import { toast } from 'sonner';

import { getMyUserId } from '@/common/lib/identity';
import { socket } from '@/common/lib/socket';
import { NOT_IN_CALL, usePresenceStore } from '@/common/store/presence.store';
import { useRoom, useRoomStore } from '@/common/store/room.store';
import { useVectorStore } from '@/common/store/vector.store';
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
        // The same three numbers mean the camera on a vector board.
        if (useRoomStore.getState().room.engine === 'vector') {
          useVectorStore.getState().setCamera({ x, y, zoom: scale });
        } else {
          useViewportStore.setState({ x, y, scale });
        }
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

    /**
     * The call roster from the server's webhooks, for everyone including
     * people not in the call. Tabs that are in the call learn finer state
     * (speaking, muted) from the media room itself.
     */
    const handleCallParticipants = (userIds: string[]) => {
      const { calls, setCallState, clearCallState } = usePresenceStore.getState();
      const present = new Set(userIds);

      userIds.forEach((userId) => {
        if (!calls.get(userId)?.inCall) setCallState(userId, { ...NOT_IN_CALL, inCall: true });
      });

      calls.forEach((_, userId) => {
        if (!present.has(userId)) clearCallState(userId);
      });
    };

    const handleModerated = (targetUserId: string, track: 'audio' | 'video') => {
      if (targetUserId !== getMyUserId()) return;

      toast.warning(
        track === 'audio'
          ? 'The board owner muted your microphone.'
          : 'The board owner turned off your camera.',
      );
    };

    // Named handlers, not the bare `socket.off(event)` form: `user_disconnected`
    // also has a listener in Room.context.tsx, which a bare `.off` would strip.
    socket.on('cursor_moved', handleCursorMoved);
    socket.on('viewport_changed', handleViewportChanged);
    socket.on('summoned', handleSummoned);
    socket.on('user_disconnected', handleUserDisconnected);
    socket.on('call_participants', handleCallParticipants);
    socket.on('rtc_moderated', handleModerated);

    return () => {
      socket.off('cursor_moved', handleCursorMoved);
      socket.off('viewport_changed', handleViewportChanged);
      socket.off('summoned', handleSummoned);
      socket.off('user_disconnected', handleUserDisconnected);
      socket.off('call_participants', handleCallParticipants);
      socket.off('rtc_moderated', handleModerated);
    };
  }, [users]);
};
