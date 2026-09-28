import { useEffect, useState } from 'react';

import { motion } from 'framer-motion';
import { BsCursorFill } from 'react-icons/bs';

import { socket } from '@/common/lib/socket';
import { toScreen } from '@/common/lib/coords';
import { useRoom } from '@/common/store/room.store';
import { useViewportStore } from '@/common/store/viewport.store';

const UserMouse = ({ userId }: { userId: string }) => {
  const { users } = useRoom();
  const x = useViewportStore((state) => state.x);
  const y = useViewportStore((state) => state.y);
  const scale = useViewportStore((state) => state.scale);

  const [msg, setMsg] = useState('');
  const [pos, setPos] = useState({ x: -1, y: -1 });

  useEffect(() => {
    socket.on('mouse_moved', (newX, newY, socketIdMoved) => {
      if (socketIdMoved === userId) {
        setPos({ x: newX, y: newY });
      }
    });

    const handleNewMsg = (msgUserId: string, newMsg: string) => {
      if (msgUserId === userId) {
        setMsg(newMsg);

        setTimeout(() => {
          setMsg('');
        }, 3000);
      }
    };
    socket.on('new_msg', handleNewMsg);

    return () => {
      socket.off('mouse_moved');
      socket.off('new_msg', handleNewMsg);
    };
  }, [userId]);

  return (
    <motion.div
      className={`pointer-events-none absolute left-0 top-0 z-20 text-blue-800 ${
        pos.x === -1 && 'hidden'
      }`}
      style={{ color: users.get(userId)?.color }}
      animate={{ x: toScreen(pos.x, x, scale), y: toScreen(pos.y, y, scale) }}
      transition={{ duration: 0.2, ease: 'linear' }}
    >
      <BsCursorFill className="-rotate-90" />
      {msg && (
        <p className="absolute left-5 top-full max-h-20 max-w-60 overflow-hidden text-ellipsis rounded-md bg-zinc-900 p-1 px-3 text-white">
          {msg}
        </p>
      )}
      <p className="ml-2">{users.get(userId)?.name || 'Anonymous'}</p>
    </motion.div>
  );
};

export default UserMouse;
