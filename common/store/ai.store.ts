import { create } from 'zustand';

import type { AiStatus, AiStatusUpdate } from '@/common/types/global';

export type AiRequestState = AiStatusUpdate & {
  /** Sent from this client, so its outcome deserves a toast and an undo. */
  mine: boolean;
  updatedAt: number;
};

type AiState = {
  requests: Map<string, AiRequestState>;
  /** Request ids this client minted, recorded before the first status arrives. */
  mine: Set<string>;
  /** The toolbar prompt popover, so the palette can open it too. */
  promptOpen: boolean;
  markMine: (requestId: string) => void;
  applyStatus: (update: AiStatusUpdate) => void;
  setPromptOpen: (open: boolean) => void;
};

const ACTIVE: ReadonlySet<AiStatus> = new Set(['queued', 'thinking', 'drawing']);

/** Finished requests are kept this long, so a late toast can still name them. */
const FINISHED_MEMORY_MS = 10 * 60_000;

export const useAiStore = create<AiState>((set) => ({
  requests: new Map(),
  mine: new Set(),
  promptOpen: false,

  markMine: (requestId) =>
    set((state) => {
      const mine = new Set(state.mine);
      mine.add(requestId);

      return { mine };
    }),

  applyStatus: (update) =>
    set((state) => {
      const now = Date.now();
      const requests = new Map(state.requests);

      requests.set(update.requestId, {
        ...update,
        mine: state.mine.has(update.requestId),
        updatedAt: now,
      });

      requests.forEach((request, id) => {
        if (!ACTIVE.has(request.status) && now - request.updatedAt > FINISHED_MEMORY_MS) {
          requests.delete(id);
        }
      });

      return { requests };
    }),

  setPromptOpen: (promptOpen) => set({ promptOpen }),
}));

/** The request Sketch is working on right now, or null when it is idle. */
export const selectActivity = (state: AiState): AiRequestState | null => {
  let latest: AiRequestState | null = null;

  state.requests.forEach((request) => {
    if (!ACTIVE.has(request.status)) return;

    if (!latest || request.updatedAt > latest.updatedAt) latest = request;
  });

  return latest;
};

export const useSketchActivity = () => useAiStore(selectActivity);

/** Short label for a cursor tag or a tooltip: "thinking", "drawing 3 of 12". */
export const activityLabel = (activity: AiRequestState): string => {
  if (activity.status === 'drawing') {
    return activity.progress
      ? `drawing ${activity.progress.done} of ${activity.progress.total}`
      : 'drawing';
  }

  if (activity.status === 'thinking') return 'thinking…';

  return 'queued';
};
