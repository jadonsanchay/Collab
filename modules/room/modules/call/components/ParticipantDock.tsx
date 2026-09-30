import { useParticipants, useTracks, VideoTrack } from '@livekit/components-react';
import { type Participant, Track } from 'livekit-client';
import { MicOff, Pin, PinOff } from 'lucide-react';

import { useCallStore } from '@/common/store/call.store';
import { useRoom } from '@/common/store/room.store';

/** Video tiles shown at once; more participants become audio-only avatars. */
const MAX_VIDEO_TILES = 6;

/**
 * Who is in the call: a strip of tiles at bottom-right, above the zoom
 * controls. Participants with video (pinned and speaking first) get a
 * tile, up to six; the rest are avatars. Click a tile to pin it large.
 */
const ParticipantDock = () => {
  const participants = useParticipants();
  const cameras = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const { users } = useRoom();
  const pinned = useCallStore((state) => state.pinned);
  const setPinned = useCallStore((state) => state.setPinned);

  const byIdentity = new Map(cameras.map((ref) => [ref.participant.identity, ref]));

  const ranked = [...participants].sort((a, b) => {
    const score = (participant: Participant) =>
      (participant.identity === pinned ? 4 : 0) +
      (participant.isSpeaking ? 2 : 0) +
      (participant.isCameraEnabled ? 1 : 0);

    return score(b) - score(a);
  });

  const withVideo = ranked.filter((participant) => {
    const ref = byIdentity.get(participant.identity);

    return ref && participant.isCameraEnabled;
  });
  const tiles = withVideo.slice(0, MAX_VIDEO_TILES);
  const avatars = ranked.filter((participant) => !tiles.includes(participant));

  const nameOf = (participant: Participant) =>
    users.get(participant.identity)?.name ?? participant.name ?? 'Guest';
  const colorOf = (participant: Participant) => users.get(participant.identity)?.color ?? '#3f3f46';

  return (
    <div
      aria-label="Call participants"
      className="fixed bottom-24 right-4 z-30 flex max-w-[min(90vw,60rem)] flex-wrap items-end justify-end gap-2"
    >
      {tiles.map((participant) => {
        const ref = byIdentity.get(participant.identity);
        const isPinned = pinned === participant.identity;

        if (!ref) return null;

        return (
          <div
            key={participant.identity}
            className={`relative overflow-hidden rounded-xl bg-black shadow-lg ${
              isPinned ? 'h-60 w-[26rem]' : 'h-24 w-40'
            } ${participant.isSpeaking ? 'ring-2 ring-green-400' : ''}`}
          >
            <VideoTrack
              trackRef={ref}
              className={`size-full object-cover ${participant.isLocal ? '-scale-x-100' : ''}`}
            />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 px-2 py-1 text-xs text-white">
              <span className="flex items-center gap-1 truncate">
                {nameOf(participant)}
                {!participant.isMicrophoneEnabled && <MicOff className="size-3" />}
              </span>
              <button
                type="button"
                aria-label={isPinned ? 'Unpin' : 'Pin'}
                className="rounded p-0.5 hover:bg-white/20"
                onClick={() => setPinned(isPinned ? null : participant.identity)}
              >
                {isPinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
              </button>
            </div>
          </div>
        );
      })}

      {avatars.length > 0 && (
        <ul className="flex items-center gap-1 rounded-xl bg-zinc-900/90 p-2">
          {avatars.map((participant) => (
            <li
              key={participant.identity}
              title={`${nameOf(participant)}${participant.isMicrophoneEnabled ? '' : ' (muted)'}`}
              className={`relative flex size-8 items-center justify-center rounded-full text-sm font-semibold text-white ${
                participant.isSpeaking ? 'ring-2 ring-green-400' : ''
              }`}
              style={{ backgroundColor: colorOf(participant) }}
            >
              {nameOf(participant).charAt(0)}
              {!participant.isMicrophoneEnabled && (
                <MicOff className="absolute -bottom-1 -right-1 size-3 rounded-full bg-zinc-900 p-0.5" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ParticipantDock;
