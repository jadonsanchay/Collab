import { useEffect, useRef, useState } from 'react';

import { motion } from 'framer-motion';
import { ChevronDown, MessageCircle } from 'lucide-react';

import { displayName } from '@/common/lib/displayName';
import { socket } from '@/common/lib/socket';
import { useChatStore } from '@/common/store/chat.store';
import { useRoom } from '@/common/store/room.store';

import ChatInput from './ChatInput';
import Message from './Message';

const Chat = () => {
  const room = useRoom();
  const messages = useChatStore((state) => state.messages);

  const msgList = useRef<HTMLDivElement>(null);

  const [newMsg, setNewMsg] = useState(false);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    const handleNewMsg = (userId: string, msg: string) => {
      const user = room.users.get(userId);

      useChatStore.getState().push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId,
        body: msg,
        name: displayName(userId, room.users),
        createdAt: Date.now(),
      });

      if (!opened) setNewMsg(true);
    };

    socket.on('new_msg', handleNewMsg);

    return () => {
      socket.off('new_msg', handleNewMsg);
    };
  }, [opened, room.users]);

  useEffect(() => {
    msgList.current?.scroll({ top: msgList.current?.scrollHeight });
  }, [messages]);

  return (
    <motion.div
      className="absolute bottom-0 z-50 flex h-[300px] w-full flex-col overflow-hidden rounded-t-md sm:left-36 sm:w-[30rem]"
      animate={{ y: opened ? 0 : 260 }}
      transition={{ duration: 0.2 }}
    >
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between bg-zinc-900 px-10 py-2 font-semibold text-white"
        onClick={() => {
          setOpened((prev) => !prev);
          setNewMsg(false);
        }}
      >
        <div className="flex items-center gap-2">
          <MessageCircle className="mt-[-2px]" />
          Chat
          {newMsg && (
            <p className="rounded-md bg-green-500 px-1 font-semibold text-green-900">
              New!
            </p>
          )}
        </div>

        <motion.div
          animate={{ rotate: opened ? 0 : 180 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown />
        </motion.div>
      </button>
      <div className="flex flex-1 flex-col justify-between bg-white p-3">
        <div className="h-[190px] overflow-y-scroll pr-2" ref={msgList}>
          {messages.map((message) => (
            <Message
              key={message.id}
              message={message}
              color={room.users.get(message.userId)?.color}
            />
          ))}
        </div>
        <ChatInput />
      </div>
    </motion.div>
  );
};

export default Chat;
