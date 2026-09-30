import { create } from 'zustand';

import { Move } from '@/common/types/global';

export type PlaybackSpeed = 1 | 4 | 16;

/**
 * What Rewind is showing. `cursorSeq === null` is live: the board renders
 * every move and drawing works. Any number is history: only moves with
 * `seq <= cursorSeq` that pass the user filter render, and the board is
 * read-only until "Back to live".
 */
export type HistoryView = {
  cursorSeq: number | null;
  /** Author ids to show; null shows everyone. */
  userFilter: Set<string> | null;
  playing: boolean;
  speed: PlaybackSpeed;
  panelOpen: boolean;
};

const LIVE_VIEW: HistoryView = {
  cursorSeq: null,
  userFilter: null,
  playing: false,
  speed: 4,
  panelOpen: false,
};

type HistoryState = {
  savedMoves: Move[];
  addSavedMove: (move: Move) => void;
  removeSavedMove: () => Move | undefined;
  clearSavedMoves: () => void;
  view: HistoryView;
  setPanelOpen: (open: boolean) => void;
  /** Scrubs to a sequence number. Also pauses when the caller is not playback. */
  setCursorSeq: (seq: number | null) => void;
  setUserFilter: (filter: Set<string> | null) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  /** Back to live: every move visible, playback stopped, filter kept. */
  goLive: () => void;
};

export const useHistoryStore = create<HistoryState>((set, get) => ({
  savedMoves: [],
  view: LIVE_VIEW,

  setPanelOpen: (panelOpen) =>
    set((state) => ({ view: { ...state.view, panelOpen } })),

  setCursorSeq: (cursorSeq) =>
    set((state) => ({ view: { ...state.view, cursorSeq } })),

  setUserFilter: (userFilter) =>
    set((state) => ({ view: { ...state.view, userFilter } })),

  setPlaying: (playing) => set((state) => ({ view: { ...state.view, playing } })),

  setSpeed: (speed) => set((state) => ({ view: { ...state.view, speed } })),

  goLive: () =>
    set((state) => ({
      view: { ...state.view, cursorSeq: null, playing: false },
    })),

  addSavedMove: (move) => {
    if (move.options.mode === 'select') return;

    set((state) => ({ savedMoves: [move, ...state.savedMoves] }));
  },

  removeSavedMove: () => {
    const move = get().savedMoves.at(0);

    set((state) => ({ savedMoves: state.savedMoves.slice(1) }));

    return move;
  },

  clearSavedMoves: () => set({ savedMoves: [] }),
}));

export const useSavedMoves = () => useHistoryStore((state) => state.savedMoves);

export const useHistoryView = () => useHistoryStore((state) => state.view);

/** True while Rewind is showing the past; drawing and undo are disabled. */
export const useViewingHistory = () =>
  useHistoryStore((state) => state.view.cursorSeq !== null);

export const isViewingHistory = () =>
  useHistoryStore.getState().view.cursorSeq !== null;

export const useSetSavedMoves = () => {
  const addSavedMove = useHistoryStore((state) => state.addSavedMove);
  const removeSavedMove = useHistoryStore((state) => state.removeSavedMove);
  const clearSavedMoves = useHistoryStore((state) => state.clearSavedMoves);

  return { addSavedMove, removeSavedMove, clearSavedMoves };
};
