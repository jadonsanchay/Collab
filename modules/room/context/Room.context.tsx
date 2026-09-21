import {
  createContext,
  Dispatch,
  RefObject,
  SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';

import { MotionValue, useMotionValue } from 'framer-motion';
import { toast } from 'react-toastify';

import { getMyUserId } from '@/common/lib/identity';
import { socket } from '@/common/lib/socket';
import { useSetUsers } from '@/common/recoil/room';
import { useSetRoom, useRoom } from '@/common/recoil/room/room.hooks';
import { Move, User } from '@/common/types/global';

export const roomContext = createContext<{
  x: MotionValue<number>;
  y: MotionValue<number>;
  undoRef: RefObject<HTMLButtonElement | null>;
  redoRef: RefObject<HTMLButtonElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  bgRef: RefObject<HTMLCanvasElement | null>;
  selectionRefs: RefObject<HTMLButtonElement[]>;
  minimapRef: RefObject<HTMLCanvasElement | null>;
  moveImage: { base64: string; x?: number; y?: number };
  setMoveImage: Dispatch<
    SetStateAction<{
      base64: string;
      x?: number | undefined;
      y?: number | undefined;
    }>
  >;
}>(null!);
const RoomContextProvider = ({ children }: { children: ReactNode }) => {
  const setRoom = useSetRoom();
  const { users } = useRoom();
  const { handleAddUser, handleRemoveUser } = useSetUsers();

  const undoRef = useRef<HTMLButtonElement>(null);
  const redoRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const selectionRefs = useRef<HTMLButtonElement[]>([]);

  const [moveImage, setMoveImage] = useState<{
    base64: string;
    x?: number;
    y?: number;
  }>({ base64: '' });

  useEffect(() => {
    if (moveImage.base64 && !moveImage.x && !moveImage.y)
      setMoveImage({ base64: moveImage.base64, x: 50, y: 50 });
  }, [moveImage]);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  useEffect(() => {
    socket.on('room', (room, usersMovesToParse, usersToParse) => {
      const usersMoves = new Map<string, Move[]>(JSON.parse(usersMovesToParse));
      const usersParsed = new Map<string, User>(JSON.parse(usersToParse));

      const newUsers = new Map<string, User>();

      const myUserId = getMyUserId();

      usersParsed.forEach((user, id) => {
        // Colours come from the server now. They used to be derived from the
        // order this client happened to receive users in, so two people could
        // see the same third person in different colours.
        if (id === myUserId) return;

        newUsers.set(id, { name: user.name, color: user.color });
      });

      setRoom((prev) => ({
        ...prev,
        users: newUsers,
        usersMoves,
        movesWithoutUser: room.drawed,
      }));
    });

    socket.on('new_user', (userId, username, color) => {
      toast(`${username} has joined the room.`, {
        position: 'top-center',
        theme: 'colored',
      });

      handleAddUser(userId, username, color);
    });

    socket.on('user_disconnected', (userId) => {
      toast(`${users.get(userId)?.name || 'Anonymous'} has left the room.`, {
        position: 'top-center',
        theme: 'colored',
      });

      handleRemoveUser(userId);
    });

    socket.on('rate_limited', () => {
      toast('You are sending messages too quickly.', {
        position: 'top-center',
        theme: 'colored',
        type: 'warning',
      });
    });

    return () => {
      socket.off('room');
      socket.off('new_user');
      socket.off('user_disconnected');
      socket.off('rate_limited');
    };
  }, [handleAddUser, handleRemoveUser, setRoom, users]);

  const value = useMemo(
    () => ({
      x,
      y,
      bgRef,
      undoRef,
      redoRef,
      canvasRef,
      setMoveImage,
      moveImage,
      minimapRef,
      selectionRefs,
    }),
    [
      x,
      y,
      bgRef,
      undoRef,
      redoRef,
      canvasRef,
      setMoveImage,
      moveImage,
      minimapRef,
      selectionRefs,
    ],
  );

  return <roomContext.Provider value={value}>{children}</roomContext.Provider>;
};

export default RoomContextProvider;
