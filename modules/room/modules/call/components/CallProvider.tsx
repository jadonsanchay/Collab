import { LiveKitRoom, RoomAudioRenderer, StartAudio } from '@livekit/components-react';
import { type MediaDeviceFailure, ScreenSharePresets, VideoPresets } from 'livekit-client';
import { toast } from 'sonner';

import { useCallStore } from '@/common/store/call.store';

import { useCallPresence } from '../hooks/useCallPresence';
import CallControls from './CallControls';
import ParticipantDock from './ParticipantDock';
import ScreenShareOverlay from './ScreenShareOverlay';

/** Hooks that need the room context, kept apart so the provider stays a shell. */
const CallPresenceBridge = () => {
  useCallPresence();

  return null;
};

const describeDeviceFailure = (failure?: MediaDeviceFailure) => {
  switch (failure) {
    case 'PermissionDenied':
      return 'Collab was not allowed to use your microphone or camera. Check the browser permission and try again.';
    case 'NotFound':
      return 'No microphone or camera was found.';
    case 'DeviceInUse':
      return 'Your microphone or camera is in use by another app.';
    default:
      return 'Your microphone or camera could not be started.';
  }
};

/**
 * The connected call: a LiveKit room joined with the token the store
 * fetched, nothing published until the user toggles a track. Camera is
 * capped at 720p and screen share at 1080p 15 fps, with simulcast and
 * adaptive streaming so the SFU sends small tiles small layers.
 */
const CallProvider = () => {
  const token = useCallStore((state) => state.token);
  const url = useCallStore((state) => state.url);
  const setStatus = useCallStore((state) => state.setStatus);
  const leave = useCallStore((state) => state.leave);

  if (!token || !url) return null;

  return (
    <LiveKitRoom
      serverUrl={url}
      token={token}
      connect
      audio={false}
      video={false}
      options={{
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
        publishDefaults: {
          simulcast: true,
          screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
        },
      }}
      onConnected={() => setStatus('connected')}
      onDisconnected={() => leave()}
      onError={(error) => {
        setStatus('error', error.message);
        toast.error('The call dropped.', {
          action: {
            label: 'Retry',
            onClick: () => {
              const { join } = useCallStore.getState();
              const boardId = window.location.pathname.slice(1);

              join(boardId);
            },
          },
        });
      }}
      onMediaDeviceFailure={(failure) => toast.error(describeDeviceFailure(failure))}
    >
      <RoomAudioRenderer />
      <StartAudio
        label="Click to enable call audio"
        className="fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-full bg-amber-500 px-4 py-1.5 text-sm font-semibold text-black shadow"
      />
      <CallPresenceBridge />
      <CallControls />
      <ParticipantDock />
      <ScreenShareOverlay />
    </LiveKitRoom>
  );
};

export default CallProvider;
