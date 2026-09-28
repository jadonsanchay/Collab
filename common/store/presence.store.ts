import { create } from 'zustand';

type CursorEntry = { x: number; y: number; lastUpdate: number };
type ViewportEntry = { x: number; y: number; scale: number };

type PresenceState = {
  cursors: Map<string, CursorEntry>;
  viewports: Map<string, ViewportEntry>;
  following: string | null;
  setCursor: (userId: string, x: number, y: number) => void;
  setViewport: (userId: string, x: number, y: number, scale: number) => void;
  removeUser: (userId: string) => void;
  setFollowing: (userId: string | null) => void;
};

export const usePresenceStore = create<PresenceState>((set) => ({
  cursors: new Map(),
  viewports: new Map(),
  following: null,

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
      cursors.delete(userId);
      viewports.delete(userId);

      return {
        cursors,
        viewports,
        following: state.following === userId ? null : state.following,
      };
    }),

  setFollowing: (userId) => set({ following: userId }),
}));
