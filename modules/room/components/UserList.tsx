import { Megaphone, Sparkles } from 'lucide-react';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';
import { isAiUser } from '@/common/constants/ai';
import { socket } from '@/common/lib/socket';
import { activityLabel, useSketchActivity } from '@/common/store/ai.store';
import { usePresenceStore } from '@/common/store/presence.store';
import { useRoom } from '@/common/store/room.store';

const UserList = () => {
  const { users } = useRoom();
  const following = usePresenceStore((state) => state.following);
  const setFollowing = usePresenceStore((state) => state.setFollowing);
  const activity = useSketchActivity();

  return (
    <div className="flex items-center gap-2">
      <div className="flex">
        {[...users.keys()].map((userId, index) => {
          const user = users.get(userId);
          const isFollowed = following === userId;
          const sketch = isAiUser(userId);
          // Sketch's avatar pulses while it is thinking or drawing.
          const busy = sketch && activity !== null;

          let title = user?.name;
          if (user?.offline) title = `${user.name} (reconnecting)`;
          else if (busy && activity) title = `${user?.name} (${activityLabel(activity)})`;

          return (
            <button
              type="button"
              key={userId}
              data-busy={busy || undefined}
              className={`flex size-5 select-none items-center justify-center rounded-full text-xs text-white md:size-8 md:text-base lg:size-12 ${
                isFollowed || busy ? 'ring-2 ring-offset-2' : ''
              } ${busy ? 'animate-pulse' : ''}`}
              style={{
                backgroundColor: user?.color || 'black',
                marginLeft: index !== 0 ? '-0.5rem' : 0,
                // Dimmed while their socket is gone but their place is still held.
                opacity: user?.offline ? 0.4 : 1,
                ...(isFollowed || busy ? { '--tw-ring-color': user?.color } : {}),
              }}
              title={title}
              onClick={() => setFollowing(isFollowed ? null : userId)}
            >
              {sketch ? (
                <Sparkles className="size-3 md:size-4 lg:size-6" />
              ) : (
                user?.name.split('')[0] || 'A'
              )}
            </button>
          );
        })}
      </div>

      <HotkeyTooltip label="Bring everyone to your view">
        <button
          type="button"
          aria-label="Summon everyone to your view"
          className="flex size-8 items-center justify-center rounded-full bg-zinc-800 text-white"
          onClick={() => socket.emit('summon')}
        >
          <Megaphone />
        </button>
      </HotkeyTooltip>
    </div>
  );
};

export default UserList;
