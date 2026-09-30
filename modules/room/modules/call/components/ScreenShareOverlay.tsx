import { useState } from 'react';

import { useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Maximize2, Minimize2 } from 'lucide-react';

import { useRoom } from '@/common/store/room.store';

/**
 * A shared screen, when someone is sharing: a resizable overlay at the
 * bottom-right, above the participant dock. One at a time is shown; the
 * most recent share wins.
 */
const ScreenShareOverlay = () => {
  const shares = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });
  const { users } = useRoom();
  const [large, setLarge] = useState(false);

  const share = shares[shares.length - 1];

  if (!share) return null;

  const name = users.get(share.participant.identity)?.name ?? share.participant.name ?? 'Someone';

  return (
    <div
      aria-label={`${name}'s screen`}
      className={`fixed right-4 top-20 z-30 overflow-hidden rounded-xl bg-black shadow-2xl ${
        large ? 'h-[60vh] w-[70vw]' : 'h-56 w-96'
      }`}
    >
      <VideoTrack trackRef={share} className="size-full object-contain" />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 px-2 py-1 text-xs text-white">
        <span>{name} is sharing</span>
        <button
          type="button"
          aria-label={large ? 'Shrink shared screen' : 'Enlarge shared screen'}
          className="rounded p-0.5 hover:bg-white/20"
          onClick={() => setLarge((previous) => !previous)}
        >
          {large ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
        </button>
      </div>
    </div>
  );
};

export default ScreenShareOverlay;
