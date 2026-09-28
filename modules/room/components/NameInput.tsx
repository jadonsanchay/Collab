import { FormEvent, useEffect, useState } from 'react';

import { useRouter } from 'next/router';

import { socket } from '@/common/lib/socket';
import { useSetRoomId } from '@/common/store/room.store';
import { MAX_USERNAME_LENGTH, usernameSchema } from '@/common/schemas/user';
import NotFoundModal from '@/modules/home/modals/NotFound';
import { useModal } from '@/modules/modal';

const NameInput = () => {
  const setRoomId = useSetRoomId();
  const { openModal } = useModal();

  const [name, setName] = useState('');

  const router = useRouter();
  const roomId = (router.query.roomId || '').toString();

  useEffect(() => {
    if (!roomId) return undefined;

    socket.emit('check_room', roomId);

    socket.on('room_exists', (exists) => {
      if (!exists) {
        router.push('/');
      }
    });

    return () => {
      socket.off('room_exists');
    };
  }, [roomId, router]);

  useEffect(() => {
    const handleJoined = (roomIdFromServer: string, failed?: boolean) => {
      if (failed) {
        router.push('/');
        openModal(<NotFoundModal id={roomIdFromServer} />);
      } else setRoomId(roomIdFromServer);
    };

    socket.on('joined', handleJoined);

    return () => {
      socket.off('joined', handleJoined);
    };
  }, [openModal, router, setRoomId]);

  // Same schema the server validates with, so an unusable name is a disabled
  // button here rather than a dropped event there.
  const parsedName = usernameSchema.safeParse(name);

  const handleJoinRoom = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!parsedName.success) return;

    socket.emit('join_room', roomId, parsedName.data);
  };

  return (
    <form
      className="my-24 flex flex-col items-center"
      onSubmit={handleJoinRoom}
    >
      <h1 className="text-5xl font-extrabold leading-tight sm:text-extra">
        Collab
      </h1>
      <h3 className="text-xl sm:text-2xl">Real-time whiteboard</h3>

      <label htmlFor="username" className="mb-3 mt-10 flex flex-col gap-2">
        <span className="self-start font-bold leading-tight">
          Enter your name
        </span>
        <input
          className="rounded-xl border p-5 py-1"
          id="username"
          placeholder="Username..."
          value={name}
          maxLength={MAX_USERNAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <button
        className="btn disabled:cursor-not-allowed disabled:opacity-40"
        type="submit"
        disabled={!parsedName.success}
      >
        Enter room
      </button>
    </form>
  );
};

export default NameInput;
