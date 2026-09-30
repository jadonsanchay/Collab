import { FormEvent, useState } from 'react';

import { Send } from 'lucide-react';

import { canChat } from '@/common/constants/roles';
import { useFeatureFlag } from '@/common/hooks/useFeatureFlag';
import { socket } from '@/common/lib/socket';
import { chatMessageSchema, MAX_MESSAGE_LENGTH } from '@/common/schemas/user';
import { useMyRole } from '@/common/store/room.store';

import { parseSketchMention, requestSketch } from '../../../lib/ai';

const ChatInput = () => {
  const [msg, setMsg] = useState('');
  const ai = useFeatureFlag('ai');
  const allowed = canChat(useMyRole());

  let placeholder = 'Message...';
  if (!allowed) placeholder = 'Viewers can read but not chat';
  else if (ai) placeholder = 'Message... (@sketch to draw)';

  // The server validates with this same schema and drops what fails, so
  // checking here is what turns a silently lost message into a disabled
  // button. Sending the parsed value keeps the two sides byte-identical.
  const parsed = chatMessageSchema.safeParse(msg);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!parsed.success) return;

    socket.emit('send_msg', parsed.data);

    // "@sketch draw a box" is a normal chat message the room can read, and
    // also a request. Without AI on the server it is just a message.
    const mention = ai ? parseSketchMention(parsed.data) : null;

    if (mention !== null) requestSketch('draw', { prompt: mention || undefined });

    setMsg('');
  };

  return (
    <form className="flex w-full items-center gap-2" onSubmit={handleSubmit}>
      <input
        className="w-full rounded-xl border border-zinc-300 p-5 py-1"
        // The input had no label of any kind, so nothing announced it to a
        // screen reader and nothing could address it in a test.
        aria-label="Message"
        placeholder={placeholder}
        value={msg}
        maxLength={MAX_MESSAGE_LENGTH}
        disabled={!allowed}
        onChange={(e) => setMsg(e.target.value)}
      />
      <button
        className="btn-icon h-full w-10 bg-black disabled:cursor-not-allowed disabled:opacity-40"
        type="submit"
        disabled={!parsed.success || !allowed}
      >
        <Send />
      </button>
    </form>
  );
};

export default ChatInput;
