import { BsMegaphone } from 'react-icons/bs';

import { socket } from '@/common/lib/socket';
import { usePresenceStore } from '@/common/store/presence.store';
import { useRoom } from '@/common/store/room.store';

const UserList = () => {
  const { users } = useRoom();
  const following = usePresenceStore((state) => state.following);
  const setFollowing = usePresenceStore((state) => state.setFollowing);

  return (
    <div className="absolute z-30 flex items-center gap-2 p-5">
      <div className="flex">
        {[...users.keys()].map((userId, index) => {
          const user = users.get(userId);
          const isFollowed = following === userId;

          return (
            <button
              type="button"
              key={userId}
              className={`flex size-5 select-none items-center justify-center rounded-full text-xs text-white md:size-8 md:text-base lg:size-12 ${
                isFollowed ? 'ring-2 ring-offset-2' : ''
              }`}
              style={{
                backgroundColor: user?.color || 'black',
                marginLeft: index !== 0 ? '-0.5rem' : 0,
                // Dimmed while their socket is gone but their place is still held.
                opacity: user?.offline ? 0.4 : 1,
                ...(isFollowed ? { '--tw-ring-color': user?.color } : {}),
              }}
              title={
                user?.offline ? `${user?.name} (reconnecting)` : user?.name
              }
              onClick={() => setFollowing(isFollowed ? null : userId)}
            >
              {user?.name.split('')[0] || 'A'}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        title="Bring everyone to your view"
        className="flex size-8 items-center justify-center rounded-full bg-zinc-800 text-white"
        onClick={() => socket.emit('summon')}
      >
        <BsMegaphone />
      </button>
    </div>
  );
};

export default UserList;
