import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';

import { getNextColor } from '@/common/lib/getNextColor';
import { Move } from '@/common/types/global';

import { DEFAULT_ROOM, roomAtom } from './room.atom';

export const useRoom = () => {
  const room = useRecoilValue(roomAtom);

  return room;
};

export const useSetRoom = () => {
  const setRoom = useSetRecoilState(roomAtom);

  return setRoom;
};

export const useSetRoomId = () => {
  const setRoomId = useSetRecoilState(roomAtom);

  const handleSetRoomId = (id: string) => {
    setRoomId({ ...DEFAULT_ROOM, id });
  };

  return handleSetRoomId;
};

export const useSetUsers = () => {
  const setRoom = useSetRecoilState(roomAtom);

  /**
   * Every handler below copies the Maps before changing them. They used to
   * assign `prev.users` to a new name and mutate that, which is the same Map:
   * Recoil then held state that had already changed underneath it, so a
   * re-render could be skipped because the old and new values were identical
   * by reference.
   */
  const handleAddUser = (userId: string, name: string) => {
    setRoom((prev) => {
      const newUsers = new Map(prev.users);
      const newUsersMoves = new Map(prev.usersMoves);

      const color = getNextColor([...newUsers.values()].pop()?.color);

      newUsers.set(userId, {
        name,
        color,
      });
      newUsersMoves.set(userId, []);

      return { ...prev, users: newUsers, usersMoves: newUsersMoves };
    });
  };

  const handleRemoveUser = (userId: string) => {
    setRoom((prev) => {
      const newUsers = new Map(prev.users);
      const newUsersMoves = new Map(prev.usersMoves);

      const userMoves = newUsersMoves.get(userId);

      newUsers.delete(userId);
      newUsersMoves.delete(userId);

      return {
        ...prev,
        users: newUsers,
        usersMoves: newUsersMoves,
        movesWithoutUser: [...prev.movesWithoutUser, ...(userMoves || [])],
      };
    });
  };

  const handleAddMoveToUser = (userId: string, moves: Move) => {
    setRoom((prev) => {
      const newUsersMoves = new Map(prev.usersMoves);
      const oldMoves = prev.usersMoves.get(userId);

      newUsersMoves.set(userId, [...(oldMoves || []), moves]);

      return { ...prev, usersMoves: newUsersMoves };
    });
  };

  const handleRemoveMoveFromUser = (userId: string) => {
    setRoom((prev) => {
      const newUsersMoves = new Map(prev.usersMoves);

      // Copy the array too: `pop` on the stored one would mutate the move list
      // Recoil is still holding.
      const oldMoves = [...(prev.usersMoves.get(userId) || [])];
      oldMoves.pop();

      newUsersMoves.set(userId, oldMoves);

      return { ...prev, usersMoves: newUsersMoves };
    });
  };

  return {
    handleAddUser,
    handleRemoveUser,
    handleAddMoveToUser,
    handleRemoveMoveFromUser,
  };
};

export const useMyMoves = () => {
  const [room, setRoom] = useRecoilState(roomAtom);

  const handleAddMyMove = (move: Move) => {
    setRoom((prev) => {
      if (prev.myMoves[prev.myMoves.length - 1]?.options.mode === 'select')
        return {
          ...prev,
          myMoves: [...prev.myMoves.slice(0, prev.myMoves.length - 1), move],
        };

      return { ...prev, myMoves: [...prev.myMoves, move] };
    });
  };

  const handleRemoveMyMove = () => {
    const newMoves = [...room.myMoves];
    const move = newMoves.pop();

    setRoom((prev) => ({ ...prev, myMoves: newMoves }));

    return move;
  };

  return { handleAddMyMove, handleRemoveMyMove, myMoves: room.myMoves };
};
