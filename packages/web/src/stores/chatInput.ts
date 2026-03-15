import { create } from 'zustand';

interface PendingMention {
  userId: string;
  username: string;
}

interface ChatInputState {
  pendingMention: PendingMention | null;
  insertMention: (userId: string, username: string) => void;
  clearPendingMention: () => void;
}

export const useChatInputStore = create<ChatInputState>((set) => ({
  pendingMention: null,
  insertMention: (userId: string, username: string) => set({ pendingMention: { userId, username } }),
  clearPendingMention: () => set({ pendingMention: null }),
}));

// Convenience accessor for non-hook contexts
export const chatInputStore = {
  state: () => useChatInputStore.getState(),
  insertMention: (userId: string, username: string) =>
    useChatInputStore.getState().insertMention(userId, username),
  clearPendingMention: () => useChatInputStore.getState().clearPendingMention(),
};
