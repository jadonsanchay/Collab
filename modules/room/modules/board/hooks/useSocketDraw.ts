import { useEffect } from 'react';

import { socket } from '@/common/lib/socket';
import { useSetUsers } from '@/common/store/room.store';
import { Move } from '@/common/types/global';

export const useSocketDraw = (drawing: boolean) => {
  const { handleAddMoveToUser, handleRemoveMoveFromUser } = useSetUsers();

  useEffect(() => {
    /**
     * Remote moves that arrived mid-stroke, applied once this stroke finishes.
     *
     * This used to be a single move and a single user id, so if two people
     * drew while you were drawing, only the last of their strokes ever
     * appeared — the earlier ones were overwritten and silently lost.
     */
    const deferred: { userId: string; move: Move }[] = [];

    socket.on('user_draw', (move, userId) => {
      if (drawing) deferred.push({ userId, move });
      else handleAddMoveToUser(userId, move);
    });

    return () => {
      socket.off('user_draw');

      deferred.forEach(({ userId, move }) => handleAddMoveToUser(userId, move));
    };
  }, [drawing, handleAddMoveToUser]);

  useEffect(() => {
    socket.on('user_undo', (userId) => {
      handleRemoveMoveFromUser(userId);
    });

    return () => {
      socket.off('user_undo');
    };
  }, [handleRemoveMoveFromUser]);
};
