import { Megaphone, MicOff, MonitorUp, Phone, Sparkles } from 'lucide-react';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';
import { isAiUser } from '@/common/constants/ai';
import { socket } from '@/common/lib/socket';
import { activityLabel, useSketchActivity } from '@/common/store/ai.store';
import { type CallState, usePresenceStore } from '@/common/store/presence.store';
import { useRoom } from '@/common/store/room.store';

/** The small badge on an avatar of someone in the call: sharing, muted, or just present. */
const CallBadge = ({ call }: { call: CallState }) => {
  let icon = <Phone className="size-3" />;

  if (call.sharingScreen) icon = <MonitorUp className="size-3" />;
  else if (call.micMuted) icon = <MicOff className="size-3" />;

  return (
    <span className="absolute -bottom-1 -right-1 flex items-center rounded-full bg-zinc-900 p-0.5 text-white">
      {icon}
    </span>
  );
};

const UserList = () => {
  const { users } = useRoom();
  const following = usePresenceStore((state) => state.following);
  const setFollowing = usePresenceStore((state) => state.setFollowing);
  const calls = usePresenceStore((state) => state.calls);
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
          const call = calls.get(userId);
          const speaking = Boolean(call?.speaking);

          let title = user?.name;
          if (user?.offline) title = `${user.name} (reconnecting)`;
          else if (busy && activity) title = `${user?.name} (${activityLabel(activity)})`;
          else if (call?.inCall) title = `${user?.name} (in call${call.micMuted ? ', muted' : ''})`;

          return (
            <button
              type="button"
              key={userId}
              data-busy={busy || undefined}
              className={`relative flex size-5 select-none items-center justify-center rounded-full text-xs text-white md:size-8 md:text-base lg:size-12 ${
                isFollowed || busy || speaking ? 'ring-2 ring-offset-2' : ''
              } ${busy || speaking ? 'animate-pulse' : ''}`}
              style={{
                backgroundColor: user?.color || 'black',
                marginLeft: index !== 0 ? '-0.5rem' : 0,
                // Dimmed while their socket is gone but their place is still held.
                opacity: user?.offline ? 0.4 : 1,
                ...(speaking ? { '--tw-ring-color': '#4ade80' } : {}),
                ...(!speaking && (isFollowed || busy) ? { '--tw-ring-color': user?.color } : {}),
              }}
              title={title}
              onClick={() => setFollowing(isFollowed ? null : userId)}
            >
              {sketch ? (
                <Sparkles className="size-3 md:size-4 lg:size-6" />
              ) : (
                user?.name.split('')[0] || 'A'
              )}
              {call?.inCall && <CallBadge call={call} />}
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
