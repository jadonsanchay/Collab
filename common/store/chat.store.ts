import { create } from 'zustand';

import type { ChatMessage } from '@/common/types/global';

type ChatState = {
  messages: ChatMessage[];
  /** Replaces the list with what the room snapshot carried. */
  seed: (messages: ChatMessage[]) => void;
  push: (message: ChatMessage) => void;
  clear: () => void;
};

/**
 * The chat panel's contents. Seeded from the room snapshot so a late joiner
 * sees the conversation so far, then appended live. Arrays are replaced,
 * never mutated, like every other store here.
 */
export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  seed: (messages) => set({ messages: [...messages] }),
  push: (message) => set((state) => ({ messages: [...state.messages, message] })),
  clear: () => set({ messages: [] }),
}));
