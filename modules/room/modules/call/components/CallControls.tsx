import { useEffect } from 'react';

import {
  useConnectionState,
  useMediaDeviceSelect,
  useTrackToggle,
} from '@livekit/components-react';
import { ConnectionState, Track } from 'livekit-client';
import { Mic, MicOff, MonitorUp, PhoneOff, Settings2, Video, VideoOff } from 'lucide-react';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/common/components/ui/popover';
import { canDraw, canChat } from '@/common/constants/roles';
import { useCallStore } from '@/common/store/call.store';
import { useMyRole } from '@/common/store/room.store';

const DeviceSelect = ({
  kind,
  label,
}: {
  kind: 'audioinput' | 'videoinput' | 'audiooutput';
  label: string;
}) => {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind });
  const id = `call-device-${kind}`;

  if (!devices.length) return null;

  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-xs">
      <span className="font-semibold">{label}</span>
      <select
        id={id}
        className="rounded border p-1"
        value={activeDeviceId}
        onChange={(event) => setActiveMediaDevice(event.target.value)}
      >
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || device.deviceId}
          </option>
        ))}
      </select>
    </label>
  );
};

/**
 * Mic, camera, screen share, devices, leave. Rendered inside the LiveKit
 * room context. Publishing follows the board role: commenters get a
 * microphone only, viewers none; the server's grants enforce the same.
 */
const CallControls = () => {
  const role = useMyRole();
  const state = useConnectionState();
  const leave = useCallStore((store) => store.leave);
  const registerToggles = useCallStore((store) => store.registerToggles);

  const microphone = useTrackToggle({ source: Track.Source.Microphone });
  const camera = useTrackToggle({ source: Track.Source.Camera });
  const screen = useTrackToggle({ source: Track.Source.ScreenShare });

  const mayTalk = canChat(role);
  const mayShowVideo = canDraw(role);

  useEffect(() => {
    registerToggles({
      microphone: () => (mayTalk ? microphone.toggle() : Promise.resolve()),
      camera: () => (mayShowVideo ? camera.toggle() : Promise.resolve()),
      screenShare: () => (mayShowVideo ? screen.toggle() : Promise.resolve()),
    });

    return () => registerToggles(null);
    // The toggle functions are stable for the life of the hooks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mayTalk, mayShowVideo, registerToggles]);

  const connecting = state !== ConnectionState.Connected;

  return (
    <div className="flex items-center gap-1 rounded-lg bg-zinc-900 p-1 text-white">
      <HotkeyTooltip label={microphone.enabled ? 'Mute' : 'Unmute'} hotkey="⌘⇧D">
        <button
          type="button"
          aria-label={microphone.enabled ? 'Mute microphone' : 'Unmute microphone'}
          aria-pressed={microphone.enabled}
          className={`btn-icon ${microphone.enabled ? 'bg-green-500 text-black' : ''}`}
          disabled={connecting || !mayTalk || microphone.pending}
          onClick={() => microphone.toggle()}
        >
          {microphone.enabled ? <Mic /> : <MicOff />}
        </button>
      </HotkeyTooltip>

      <HotkeyTooltip label={camera.enabled ? 'Camera off' : 'Camera on'} hotkey="⌘⇧E">
        <button
          type="button"
          aria-label={camera.enabled ? 'Turn camera off' : 'Turn camera on'}
          aria-pressed={camera.enabled}
          className={`btn-icon ${camera.enabled ? 'bg-green-500 text-black' : ''}`}
          disabled={connecting || !mayShowVideo || camera.pending}
          onClick={() => camera.toggle()}
        >
          {camera.enabled ? <Video /> : <VideoOff />}
        </button>
      </HotkeyTooltip>

      <HotkeyTooltip label={screen.enabled ? 'Stop sharing' : 'Share screen'}>
        <button
          type="button"
          aria-label={screen.enabled ? 'Stop sharing screen' : 'Share screen'}
          aria-pressed={screen.enabled}
          className={`btn-icon ${screen.enabled ? 'bg-green-500 text-black' : ''}`}
          disabled={connecting || !mayShowVideo || screen.pending}
          onClick={() => screen.toggle()}
        >
          <MonitorUp />
        </button>
      </HotkeyTooltip>

      <Popover>
        <HotkeyTooltip label="Devices">
          <PopoverTrigger asChild>
            <button type="button" aria-label="Call devices" className="btn-icon">
              <Settings2 />
            </button>
          </PopoverTrigger>
        </HotkeyTooltip>
        <PopoverContent className="flex w-72 flex-col gap-3">
          <DeviceSelect kind="audioinput" label="Microphone" />
          <DeviceSelect kind="videoinput" label="Camera" />
          <DeviceSelect kind="audiooutput" label="Speakers" />
        </PopoverContent>
      </Popover>

      <HotkeyTooltip label="Leave call">
        <button
          type="button"
          aria-label="Leave call"
          className="btn-icon bg-red-600"
          onClick={leave}
        >
          <PhoneOff />
        </button>
      </HotkeyTooltip>
    </div>
  );
};

export default CallControls;
