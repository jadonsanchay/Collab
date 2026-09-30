import { useEffect } from 'react';

import { useRoomContext } from '@livekit/components-react';
import { type Participant, RoomEvent, Track } from 'livekit-client';

import { usePresenceStore } from '@/common/store/presence.store';

/** Follow mode switches to a new speaker only after they have held the floor this long. */
const FOLLOW_SPEAKER_DEBOUNCE_MS = 2000;

const stateOf = (participant: Participant) => ({
  inCall: true,
  micMuted: !participant.isMicrophoneEnabled,
  camOn: participant.isCameraEnabled,
  speaking: participant.isSpeaking,
  sharingScreen: participant.isScreenShareEnabled,
});

/**
 * Maps LiveKit room events onto the presence store, so the avatar stack and
 * cursors show who is in the call, muted, speaking or sharing. Runs inside
 * the LiveKit room context. Presence stays on Socket.IO for everything
 * else; this only decorates it.
 */
export const useCallPresence = () => {
  const room = useRoomContext();

  useEffect(() => {
    const presence = usePresenceStore.getState;
    let speakerTimer: ReturnType<typeof setTimeout> | null = null;

    const syncAll = () => {
      const everyone: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];

      everyone.forEach((participant) => {
        presence().setCallState(participant.identity, stateOf(participant));
      });
    };

    const onLeft = (participant: Participant) => {
      presence().clearCallState(participant.identity);
    };

    const onSpeakers = (speakers: Participant[]) => {
      syncAll();

      const loudest = speakers[0];

      if (speakerTimer) clearTimeout(speakerTimer);

      if (!loudest || loudest.identity === room.localParticipant.identity) return;

      speakerTimer = setTimeout(() => {
        const { followSpeaker, setFollowing } = presence();

        if (followSpeaker) setFollowing(loudest.identity);
      }, FOLLOW_SPEAKER_DEBOUNCE_MS);
    };

    syncAll();

    room.on(RoomEvent.ParticipantConnected, syncAll);
    room.on(RoomEvent.ParticipantDisconnected, onLeft);
    room.on(RoomEvent.TrackMuted, syncAll);
    room.on(RoomEvent.TrackUnmuted, syncAll);
    room.on(RoomEvent.TrackPublished, syncAll);
    room.on(RoomEvent.TrackUnpublished, syncAll);
    room.on(RoomEvent.LocalTrackPublished, syncAll);
    room.on(RoomEvent.LocalTrackUnpublished, syncAll);
    room.on(RoomEvent.ActiveSpeakersChanged, onSpeakers);

    return () => {
      if (speakerTimer) clearTimeout(speakerTimer);

      room.off(RoomEvent.ParticipantConnected, syncAll);
      room.off(RoomEvent.ParticipantDisconnected, onLeft);
      room.off(RoomEvent.TrackMuted, syncAll);
      room.off(RoomEvent.TrackUnmuted, syncAll);
      room.off(RoomEvent.TrackPublished, syncAll);
      room.off(RoomEvent.TrackUnpublished, syncAll);
      room.off(RoomEvent.LocalTrackPublished, syncAll);
      room.off(RoomEvent.LocalTrackUnpublished, syncAll);
      room.off(RoomEvent.ActiveSpeakersChanged, onSpeakers);

      // Leaving: this tab no longer knows who is in the call beyond the roster.
      const { calls, setCallState } = presence();
      calls.forEach((state, identity) => {
        setCallState(identity, { ...state, speaking: false, camOn: false, sharingScreen: false });
      });
    };
  }, [room]);
};

export const trackSourceLabel = (source: Track.Source) =>
  source === Track.Source.ScreenShare ? 'screen' : 'camera';
