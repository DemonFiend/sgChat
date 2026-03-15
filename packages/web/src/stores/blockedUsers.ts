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
    // Optimistic update — UI updates immediately
    const prevIds = get().blockedUserIds;
    const prevUsers = get().blockedUsers;
    const newIds = new Set(prevIds);
    newIds.add(userId);
    set({
      blockedUserIds: newIds,
      blockedUsers: [
        ...prevUsers,
        {
          id: userId,
          username: '',
          display_name: null,
          avatar_url: null,
          blocked_at: new Date().toISOString(),
        },
      ],
    });

    try {
      await api.post(`/users/${userId}/block`, {});
    } catch (err) {
      // Revert on failure
      const revertIds = new Set(get().blockedUserIds);
      revertIds.delete(userId);
      set({
        blockedUserIds: revertIds,
        blockedUsers: get().blockedUsers.filter((u) => u.id !== userId),
      });
      console.error('[blockedUsers] Failed to block user:', err);
    }
  },

  unblockUser: async (userId: string) => {
    // Optimistic update — UI updates immediately
    const prevIds = get().blockedUserIds;
    const prevUsers = get().blockedUsers;
    const removedUser = prevUsers.find((u) => u.id === userId);
    const newIds = new Set(prevIds);
    newIds.delete(userId);
    set({ blockedUserIds: newIds, blockedUsers: prevUsers.filter((u) => u.id !== userId) });

    try {
      await api.delete(`/users/${userId}/block`);
    } catch (err) {
      // Revert on failure
      const revertIds = new Set(get().blockedUserIds);
      revertIds.add(userId);
      const revertUsers = removedUser
        ? [...get().blockedUsers, removedUser]
        : get().blockedUsers;
      set({ blockedUserIds: revertIds, blockedUsers: revertUsers });
      console.error('[blockedUsers] Failed to unblock user:', err);
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
