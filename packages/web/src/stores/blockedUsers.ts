import { create } from 'zustand';
import { api } from '@/api';

interface BlockedUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  blocked_at: string;
}

interface BlockedUsersState {
  blockedUserIds: Set<string>;
  blockedUsers: BlockedUser[];
  loaded: boolean;
  fetchBlocked: () => Promise<void>;
  blockUser: (userId: string) => Promise<void>;
  unblockUser: (userId: string) => Promise<void>;
  isBlocked: (userId: string) => boolean;
  addBlockedUserId: (userId: string) => void;
  removeBlockedUserId: (userId: string) => void;
}

export const useBlockedUsersStore = create<BlockedUsersState>((set, get) => ({
  blockedUserIds: new Set(),
  blockedUsers: [],
  loaded: false,

  fetchBlocked: async () => {
    try {
      const users = await api.get<BlockedUser[]>('/users/blocked');
      const ids = new Set(users.map((u) => u.id));
      set({ blockedUsers: users, blockedUserIds: ids, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  blockUser: async (userId: string) => {
    try {
      await api.post(`/users/${userId}/block`, {});
      const { blockedUserIds, blockedUsers } = get();
      const newIds = new Set(blockedUserIds);
      newIds.add(userId);
      set({
        blockedUserIds: newIds,
        blockedUsers: [
          ...blockedUsers,
          {
            id: userId,
            username: '',
            display_name: null,
            avatar_url: null,
            blocked_at: new Date().toISOString(),
          },
        ],
      });
    } catch {
      /* handled by caller */
    }
  },

  unblockUser: async (userId: string) => {
    try {
      await api.delete(`/users/${userId}/block`);
      const { blockedUserIds, blockedUsers } = get();
      const newIds = new Set(blockedUserIds);
      newIds.delete(userId);
      set({ blockedUserIds: newIds, blockedUsers: blockedUsers.filter((u) => u.id !== userId) });
    } catch {
      /* handled by caller */
    }
  },

  isBlocked: (userId: string) => get().blockedUserIds.has(userId),

  addBlockedUserId: (userId: string) => {
    const { blockedUserIds } = get();
    const newIds = new Set(blockedUserIds);
    newIds.add(userId);
    set({ blockedUserIds: newIds });
  },

  removeBlockedUserId: (userId: string) => {
    const { blockedUserIds, blockedUsers } = get();
    const newIds = new Set(blockedUserIds);
    newIds.delete(userId);
    set({ blockedUserIds: newIds, blockedUsers: blockedUsers.filter((u) => u.id !== userId) });
  },
}));

// Convenience accessor for non-hook contexts
export const blockedUsersStore = {
  state: () => useBlockedUsersStore.getState(),
  fetchBlocked: () => useBlockedUsersStore.getState().fetchBlocked(),
  blockUser: (userId: string) => useBlockedUsersStore.getState().blockUser(userId),
  unblockUser: (userId: string) => useBlockedUsersStore.getState().unblockUser(userId),
  isBlocked: (userId: string) => useBlockedUsersStore.getState().isBlocked(userId),
  addBlockedUserId: (userId: string) => useBlockedUsersStore.getState().addBlockedUserId(userId),
  removeBlockedUserId: (userId: string) =>
    useBlockedUsersStore.getState().removeBlockedUserId(userId),
};
