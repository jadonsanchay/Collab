import { create } from 'zustand';

import type { Features } from '@/common/types/global';

type FeaturesState = {
  /** Null until the server's `features` event has arrived on this connection. */
  features: Features | null;
  setFeatures: (features: Features) => void;
};

/**
 * What the server said it has switched on. Fed by the listener registered
 * beside the socket in `common/lib/socket.ts`, read through `useFeatureFlag`.
 * Flags never ship in the bundle: until the
 * server says a feature exists, its UI does not render.
 */
export const useFeaturesStore = create<FeaturesState>((set) => ({
  features: null,
  setFeatures: (features) => set({ features }),
}));
