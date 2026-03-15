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
    try {
      await api.post(`/users/${userId}/ignore`, {});
      const { ignoredUserIds, ignoredUsers } = get();
      const newIds = new Set(ignoredUserIds);
      newIds.add(userId);
      set({
        ignoredUserIds: newIds,
        ignoredUsers: [
          ...ignoredUsers,
          {
            id: userId,
            username: '',
            display_name: null,
            avatar_url: null,
            ignored_at: new Date().toISOString(),
          },
        ],
      });
    } catch {
      /* handled by caller */
    }
  },

  unignoreUser: async (userId: string) => {
    try {
      await api.delete(`/users/${userId}/ignore`);
      const { ignoredUserIds, ignoredUsers } = get();
      const newIds = new Set(ignoredUserIds);
      newIds.delete(userId);
      set({ ignoredUserIds: newIds, ignoredUsers: ignoredUsers.filter((u) => u.id !== userId) });
    } catch {
      /* handled by caller */
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
