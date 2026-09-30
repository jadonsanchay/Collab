import { create } from 'zustand';

export type CallStatus = 'idle' | 'connecting' | 'connected' | 'error';

/** Controls the connected call module registers so hotkeys and the palette can reach them. */
export type CallToggles = {
  microphone: () => Promise<unknown>;
  camera: () => Promise<unknown>;
  screenShare: () => Promise<unknown>;
};

type CallState = {
  status: CallStatus;
  token: string | null;
  url: string | null;
  error: string | null;
  /** Participant identity whose tile is pinned large, if any. */
  pinned: string | null;
  toggles: CallToggles | null;
  join: (boardId: string) => Promise<void>;
  leave: () => void;
  setStatus: (status: CallStatus, error?: string | null) => void;
  setPinned: (identity: string | null) => void;
  registerToggles: (toggles: CallToggles | null) => void;
};

/**
 * The call session for this tab: fetching a token starts it, the LiveKit
 * room reports connection state into it, leaving clears it. Nothing here
 * imports the media SDK, so the store is cheap to load even where calls are
 * off; the SDK arrives with the call module chunk.
 */
export const useCallStore = create<CallState>((set) => ({
  status: 'idle',
  token: null,
  url: null,
  error: null,
  pinned: null,
  toggles: null,

  join: async (boardId) => {
    set({ status: 'connecting', error: null });

    try {
      const response = await fetch('/api/rtc/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ boardId }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };

        set({ status: 'error', error: body.error ?? `could not join (${response.status})` });
        return;
      }

      const { token, url } = (await response.json()) as { token: string; url: string };

      set({ token, url, status: 'connecting' });
    } catch {
      set({ status: 'error', error: 'could not reach the server' });
    }
  },

  leave: () => set({ status: 'idle', token: null, url: null, error: null, pinned: null, toggles: null }),

  setStatus: (status, error = null) => set({ status, error }),

  setPinned: (pinned) => set({ pinned }),

  registerToggles: (toggles) => set({ toggles }),
}));

export const useCallStatus = () => useCallStore((state) => state.status);
