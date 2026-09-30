import { Phone } from 'lucide-react';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';
import { useCallStore } from '@/common/store/call.store';
import { usePresenceStore } from '@/common/store/presence.store';
import { useRoom } from '@/common/store/room.store';

import { useCallHotkeys } from '../hooks/useCallHotkeys';
import CallProvider from './CallProvider';

/**
 * The top-bar entry to the board's call. Joining takes a click — browsers
 * block audio without a gesture, and nobody should find their microphone
 * live by surprise. Once joined, the connected controls take its place.
 */
const CallEntry = () => {
  const { id } = useRoom();
  const status = useCallStore((state) => state.status);
  const error = useCallStore((state) => state.error);
  const join = useCallStore((state) => state.join);
  const inCall = usePresenceStore((state) => [...state.calls.values()].filter((c) => c.inCall).length);

  useCallHotkeys();

  if (status === 'connecting' || status === 'connected') return <CallProvider />;

  return (
    <HotkeyTooltip label={error ? `Join call (${error})` : 'Join the call'}>
      <button
        type="button"
        aria-label="Join call"
        className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold text-white ${
          error ? 'bg-red-700' : 'bg-green-600'
        }`}
        onClick={() => join(id)}
      >
        <Phone className="size-4" />
        {inCall > 0 ? `Join call · ${inCall}` : 'Join call'}
      </button>
    </HotkeyTooltip>
  );
};

export default CallEntry;
