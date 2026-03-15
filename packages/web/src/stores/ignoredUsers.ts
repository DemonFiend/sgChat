import { create } from 'zustand';
import { api } from '@/api';

interface IgnoredUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  ignored_at: string;
}

interface IgnoredUsersState {
  ignoredUserIds: Set<string>;
  ignoredUsers: IgnoredUser[];
  loaded: boolean;
  fetchIgnored: () => Promise<void>;
  ignoreUser: (userId: string) => Promise<void>;
  unignoreUser: (userId: string) => Promise<void>;
  isIgnored: (userId: string) => boolean;
}

export const useIgnoredUsersStore = create<IgnoredUsersState>((set, get) => ({
  ignoredUserIds: new Set(),
  ignoredUsers: [],
  loaded: false,

  fetchIgnored: async () => {
    try {
      const users = await api.get<IgnoredUser[]>('/users/ignored');
      const ids = new Set(users.map((u) => u.id));
      set({ ignoredUsers: users, ignoredUserIds: ids, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  ignoreUser: async (userId: string) => {
    // Optimistic update — UI updates immediately
    const prevIds = get().ignoredUserIds;
    const prevUsers = get().ignoredUsers;
    const newIds = new Set(prevIds);
    newIds.add(userId);
    set({
      ignoredUserIds: newIds,
      ignoredUsers: [
        ...prevUsers,
        {
          id: userId,
          username: '',
          display_name: null,
          avatar_url: null,
          ignored_at: new Date().toISOString(),
        },
      ],
    });

    try {
      await api.post(`/users/${userId}/ignore`, {});
    } catch (err) {
      // Revert on failure
      const revertIds = new Set(get().ignoredUserIds);
      revertIds.delete(userId);
      set({
        ignoredUserIds: revertIds,
        ignoredUsers: get().ignoredUsers.filter((u) => u.id !== userId),
      });
      console.error('[ignoredUsers] Failed to ignore user:', err);
    }
  },

  unignoreUser: async (userId: string) => {
    // Optimistic update — UI updates immediately
    const prevIds = get().ignoredUserIds;
    const prevUsers = get().ignoredUsers;
    const removedUser = prevUsers.find((u) => u.id === userId);
    const newIds = new Set(prevIds);
    newIds.delete(userId);
    set({ ignoredUserIds: newIds, ignoredUsers: prevUsers.filter((u) => u.id !== userId) });

    try {
      await api.delete(`/users/${userId}/ignore`);
    } catch (err) {
      // Revert on failure
      const revertIds = new Set(get().ignoredUserIds);
      revertIds.add(userId);
      const revertUsers = removedUser
        ? [...get().ignoredUsers, removedUser]
        : get().ignoredUsers;
      set({ ignoredUserIds: revertIds, ignoredUsers: revertUsers });
      console.error('[ignoredUsers] Failed to unignore user:', err);
    }
  },

  isIgnored: (userId: string) => get().ignoredUserIds.has(userId),
}));

// Convenience accessor for non-hook contexts
export const ignoredUsersStore = {
  state: () => useIgnoredUsersStore.getState(),
  fetchIgnored: () => useIgnoredUsersStore.getState().fetchIgnored(),
  ignoreUser: (userId: string) => useIgnoredUsersStore.getState().ignoreUser(userId),
  unignoreUser: (userId: string) => useIgnoredUsersStore.getState().unignoreUser(userId),
  isIgnored: (userId: string) => useIgnoredUsersStore.getState().isIgnored(userId),
};
