import { create } from 'zustand';

import { Move } from '@/common/types/global';

type HistoryState = {
  savedMoves: Move[];
  addSavedMove: (move: Move) => void;
  removeSavedMove: () => Move | undefined;
  clearSavedMoves: () => void;
};

export const useHistoryStore = create<HistoryState>((set, get) => ({
  savedMoves: [],

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

export const useSetSavedMoves = () => {
  const addSavedMove = useHistoryStore((state) => state.addSavedMove);
  const removeSavedMove = useHistoryStore((state) => state.removeSavedMove);
  const clearSavedMoves = useHistoryStore((state) => state.clearSavedMoves);

  return { addSavedMove, removeSavedMove, clearSavedMoves };
};
