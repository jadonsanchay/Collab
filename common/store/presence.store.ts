import { create } from 'zustand';

type CursorEntry = { x: number; y: number; lastUpdate: number };
type ViewportEntry = { x: number; y: number; scale: number };

/** What a user is doing in the board's call, merged onto the same presence record. */
export type CallState = {
  inCall: boolean;
  micMuted: boolean;
  camOn: boolean;
  speaking: boolean;
  sharingScreen: boolean;
};

export const NOT_IN_CALL: CallState = {
  inCall: false,
  micMuted: true,
  camOn: false,
  speaking: false,
  sharingScreen: false,
};

type PresenceState = {
  cursors: Map<string, CursorEntry>;
  viewports: Map<string, ViewportEntry>;
  calls: Map<string, CallState>;
  following: string | null;
  /** Follow whoever is speaking, debounced by the caller. */
  followSpeaker: boolean;
  setCursor: (userId: string, x: number, y: number) => void;
  setViewport: (userId: string, x: number, y: number, scale: number) => void;
  setCallState: (userId: string, state: Partial<CallState>) => void;
  clearCallState: (userId: string) => void;
  removeUser: (userId: string) => void;
  setFollowing: (userId: string | null) => void;
  setFollowSpeaker: (follow: boolean) => void;
};

export const usePresenceStore = create<PresenceState>((set) => ({
  cursors: new Map(),
  viewports: new Map(),
  calls: new Map(),
  following: null,
  followSpeaker: false,

  setCallState: (userId, state) =>
    set((current) => {
      const calls = new Map(current.calls);
      calls.set(userId, { ...(calls.get(userId) ?? NOT_IN_CALL), ...state });
      return { calls };
    }),

  clearCallState: (userId) =>
    set((current) => {
      if (!current.calls.has(userId)) return current;

      const calls = new Map(current.calls);
      calls.delete(userId);
      return { calls };
    }),

  setFollowSpeaker: (followSpeaker) => set({ followSpeaker }),

  setCursor: (userId, x, y) =>
    set((state) => {
      const cursors = new Map(state.cursors);
      cursors.set(userId, { x, y, lastUpdate: Date.now() });
      return { cursors };
    }),

  setViewport: (userId, x, y, scale) =>
    set((state) => {
      const viewports = new Map(state.viewports);
      viewports.set(userId, { x, y, scale });
      return { viewports };
    }),

  removeUser: (userId) =>
    set((state) => {
      const cursors = new Map(state.cursors);
      const viewports = new Map(state.viewports);
      const calls = new Map(state.calls);
      cursors.delete(userId);
      viewports.delete(userId);
      calls.delete(userId);

      return {
        cursors,
        viewports,
        calls,
        following: state.following === userId ? null : state.following,
      };
    }),

  setFollowing: (userId) => set({ following: userId }),
}));
