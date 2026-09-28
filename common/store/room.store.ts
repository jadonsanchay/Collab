import { create } from 'zustand';

import { ClientRoom, Move } from '@/common/types/global';

export const DEFAULT_ROOM: ClientRoom = {
  id: '',
  users: new Map(),
  usersMoves: new Map(),
  movesWithoutUser: [],
  myMoves: [],
};

type RoomUpdater = ClientRoom | ((prev: ClientRoom) => ClientRoom);

type RoomState = {
  room: ClientRoom;
  setRoom: (update: RoomUpdater) => void;
};

export const useRoomStore = create<RoomState>((set) => ({
  room: DEFAULT_ROOM,

  setRoom: (update) =>
    set((state) => ({
      room: typeof update === 'function' ? update(state.room) : update,
    })),
}));

export const useRoom = () => useRoomStore((state) => state.room);

export const useSetRoom = () => useRoomStore((state) => state.setRoom);

export const useSetRoomId = () => {
  const setRoom = useSetRoom();

  const handleSetRoomId = (id: string) => {
    setRoom({ ...DEFAULT_ROOM, id });
  };

  return handleSetRoomId;
};

export const useSetUsers = () => {
  const setRoom = useSetRoom();

  const handleAddUser = (userId: string, name: string, color: string) => {
    setRoom((prev) => {
      const newUsers = new Map(prev.users);
      const newUsersMoves = new Map(prev.usersMoves);

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

      const oldMoves = [...(prev.usersMoves.get(userId) || [])];
      oldMoves.pop();

      newUsersMoves.set(userId, oldMoves);

      return { ...prev, usersMoves: newUsersMoves };
    });
  };

  const handleSetUserPresence = (userId: string, offline: boolean) => {
    setRoom((prev) => {
      const user = prev.users.get(userId);

      if (!user) return prev;

      const newUsers = new Map(prev.users);
      newUsers.set(userId, { ...user, offline });

      return { ...prev, users: newUsers };
    });
  };

  return {
    handleAddUser,
    handleRemoveUser,
    handleAddMoveToUser,
    handleRemoveMoveFromUser,
    handleSetUserPresence,
  };
};

export const useMyMoves = () => {
  const room = useRoom();
  const setRoom = useSetRoom();

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
