import { FormEvent, useEffect, useState } from 'react';

import { LayoutGrid } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';

import AccountButton from '@/common/components/AccountButton';
import { useFeatureFlag } from '@/common/hooks/useFeatureFlag';
import { socket } from '@/common/lib/socket';
import { useSetRoomId } from '@/common/store/room.store';
import { useIdentity } from '@/common/store/session.store';
import {
  MAX_USERNAME_LENGTH,
  ROOM_ID_LENGTH,
  roomIdSchema,
  usernameSchema,
} from '@/common/schemas/user';
import { useModal } from '@/modules/modal';

import NotFoundModal from '../modals/NotFound';

const Home = () => {
  const { openModal } = useModal();
  const setAtomRoomId = useSetRoomId();

  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const persistent = useFeatureFlag('persistent');
  const auth = useFeatureFlag('auth');
  const identity = useIdentity();

  const router = useRouter();

  useEffect(() => {
    document.body.style.backgroundColor = 'white';
  }, []);

  useEffect(() => {
    socket.on('created', (roomIdFromServer) => {
      setAtomRoomId(roomIdFromServer, 'owner');
      router.push(roomIdFromServer);
    });

    const handleJoinedRoom = (
      roomIdFromServer: string,
      failed?: boolean,
      meta?: { role?: import('@/common/constants/roles').Role; reason?: string },
    ) => {
      if (!failed) {
        setAtomRoomId(roomIdFromServer, meta?.role);
        router.push(roomIdFromServer);
      } else {
        openModal(<NotFoundModal id={roomId} reason={meta?.reason} />);
      }
    };

    socket.on('joined', handleJoinedRoom);

    return () => {
      socket.off('created');
      socket.off('joined', handleJoinedRoom);
    };
  }, [openModal, roomId, router, setAtomRoomId]);

  useEffect(() => {
    socket.emit('leave_room');
    setAtomRoomId('');
  }, [setAtomRoomId]);

  // The server validates against these same schemas and drops what fails, so
  // validating here is what makes a bad name or id a disabled button instead
  // of a button that appears to do nothing.
  const parsedUsername = usernameSchema.safeParse(username);
  const parsedRoomId = roomIdSchema.safeParse(roomId);

  const handleCreateRoom = () => {
    if (!parsedUsername.success) return;

    // Every new board is an objects board. `/?engine=raster` still makes a
    // legacy drawing board, for checking old boards and the conversion path.
    const engine = router.query.engine === 'raster' ? 'raster' : 'vector';

    socket.emit('create_room', parsedUsername.data, { engine });
  };

  const handleJoinRoom = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!parsedUsername.success || !parsedRoomId.success) return;

    socket.emit('join_room', parsedRoomId.data, parsedUsername.data);
  };

  return (
    <div className="flex flex-col items-center py-24">
      {/* Account and dashboard live in the corner, where every app keeps them. */}
      <header className="fixed right-4 top-4 flex items-center gap-2">
        {auth && (!identity || identity.isGuest) ? (
          <AccountButton />
        ) : (
          persistent && (
            <Link
              href="/boards"
              className="flex items-center gap-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white"
            >
              <LayoutGrid className="size-4" /> My boards
            </Link>
          )
        )}
      </header>

      <h1 className="text-5xl font-extrabold leading-tight sm:text-extra">
        Collab
      </h1>
      <h3 className="text-xl sm:text-2xl">Real-time whiteboard</h3>

      <label htmlFor="username" className="mt-10 flex flex-col gap-2">
        <span className="self-start font-bold leading-tight">
          Enter your name
        </span>
        <input
          className="input"
          id="username"
          placeholder="Username..."
          value={username}
          maxLength={MAX_USERNAME_LENGTH}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>

      <div className="my-8 h-px w-96 bg-zinc-200" />

      <form
        className="flex flex-col items-center gap-3"
        onSubmit={handleJoinRoom}
      >
        <label htmlFor="room-id" className="flex w-full flex-col gap-2">
          <span className="self-start font-bold leading-tight">
            Enter room id
          </span>
          <input
            className="input"
            id="room-id"
            placeholder="Room id..."
            value={roomId}
            maxLength={ROOM_ID_LENGTH}
            onChange={(e) => setRoomId(e.target.value)}
          />
        </label>
        <button
          className="btn disabled:cursor-not-allowed disabled:opacity-40"
          type="submit"
          disabled={!parsedUsername.success || !parsedRoomId.success}
        >
          Join
        </button>
      </form>

      <div className="my-8 flex w-96 items-center gap-2">
        <div className="h-px w-full bg-zinc-200" />
        <p className="text-zinc-400">or</p>
        <div className="h-px w-full bg-zinc-200" />
      </div>

      <div className="flex flex-col items-center gap-2">
        <h5 className="self-start font-bold leading-tight">Create new room</h5>

        <button
          type="button"
          className="btn disabled:cursor-not-allowed disabled:opacity-40"
          onClick={handleCreateRoom}
          disabled={!parsedUsername.success}
        >
          Create
        </button>
      </div>
    </div>
  );
};

export default Home;
