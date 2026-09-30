import { getMyUserId } from '@/common/lib/identity';
import type { ChatMessage } from '@/common/types/global';

const Message = ({
  message,
  color = '#000',
}: {
  message: ChatMessage;
  /** The author's current colour; grey once they have left. */
  color?: string;
}) => {
  const me = getMyUserId() === message.userId;

  return (
    <div
      className={`my-2 flex gap-2 text-clip ${me && 'justify-end text-right'}`}
    >
      {!me && (
        <h5 style={{ color }} className="font-bold">
          {message.name}
        </h5>
      )}
      <p style={{ wordBreak: 'break-all' }}>{message.body}</p>
    </div>
  );
};

export default Message;
