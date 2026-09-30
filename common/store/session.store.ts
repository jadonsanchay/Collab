import { create } from 'zustand';

import type { Identity } from '@/common/types/global';

type SessionState = {
  /** Null until the server has answered the handshake. */
  identity: Identity | null;
  setIdentity: (identity: Identity) => void;
};

/** Who this connection is, as the server sees it. Fed from `common/lib/socket.ts`. */
export const useSessionStore = create<SessionState>((set) => ({
  identity: null,
  setIdentity: (identity) => set({ identity }),
}));

export const useIdentity = () => useSessionStore((state) => state.identity);
