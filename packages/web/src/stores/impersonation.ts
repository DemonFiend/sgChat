import { create } from 'zustand';
import { api } from '@/api';
import type { PermissionPreviewChannel, PermissionPreviewResponse } from '@sgchat/shared';

interface ImpersonationRole {
  id: string;
  name: string;
  color: string | null;
  position: number;
}

interface ImpersonationCategory {
  id: string;
  name: string;
  position: number;
}

interface ImpersonationState {
  isActive: boolean;
  serverId: string | null;
  selectedRoleIds: string[];
  allRoles: ImpersonationRole[];
  serverPermissions: Record<string, boolean> | null;
  channels: PermissionPreviewChannel[];
  categories: ImpersonationCategory[];
  isLoading: boolean;
  hasAdministrator: boolean;
}

interface ImpersonationActions {
  activate: (serverId: string, initialRoleIds: string[], allRoles: ImpersonationRole[]) => void;
  deactivate: () => void;
  toggleRole: (roleId: string) => void;
  setRoleIds: (roleIds: string[]) => void;
  fetchPreview: () => Promise<void>;
}

let fetchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let abortController: AbortController | null = null;

const initialState: ImpersonationState = {
  isActive: false,
  serverId: null,
  selectedRoleIds: [],
  allRoles: [],
  serverPermissions: null,
  channels: [],
  categories: [],
  isLoading: false,
  hasAdministrator: false,
};

export const useImpersonationStore = create<ImpersonationState & ImpersonationActions>(
  (set, get) => ({
    ...initialState,

    activate: (serverId, initialRoleIds, allRoles) => {
      set({
        isActive: true,
        serverId,
        selectedRoleIds: initialRoleIds,
        allRoles,
        isLoading: true,
      });
      get().fetchPreview();
    },

    deactivate: () => {
      if (fetchDebounceTimer) {
        clearTimeout(fetchDebounceTimer);
        fetchDebounceTimer = null;
      }
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      set(initialState);
    },

    toggleRole: (roleId) => {
      const { selectedRoleIds } = get();
      const newIds = selectedRoleIds.includes(roleId)
        ? selectedRoleIds.filter((id) => id !== roleId)
        : [...selectedRoleIds, roleId];
      set({ selectedRoleIds: newIds });

      // Debounced fetch
      if (fetchDebounceTimer) clearTimeout(fetchDebounceTimer);
      fetchDebounceTimer = setTimeout(() => {
        get().fetchPreview();
      }, 300);
    },

    setRoleIds: (roleIds) => {
      set({ selectedRoleIds: roleIds });
      if (fetchDebounceTimer) clearTimeout(fetchDebounceTimer);
      fetchDebounceTimer = setTimeout(() => {
        get().fetchPreview();
      }, 300);
    },

    fetchPreview: async () => {
      const { serverId, selectedRoleIds, isActive } = get();
      if (!serverId || !isActive) return;

      // Cancel any in-flight request
      if (abortController) {
        abortController.abort();
      }
      abortController = new AbortController();

      set({ isLoading: true });

      try {
        const data = await api.post<PermissionPreviewResponse>('/permissions/preview', {
          role_ids: selectedRoleIds,
        });

        // Only apply if still active (user may have exited during fetch)
        if (!get().isActive) return;

        const hasAdmin = data.server_permissions?.administrator === true;

        set({
          serverPermissions: data.server_permissions,
          channels: data.channels,
          categories: data.categories,
          isLoading: false,
          hasAdministrator: hasAdmin,
        });
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error('[Impersonation] Failed to fetch preview:', err);
        if (get().isActive) {
          set({ isLoading: false });
        }
      }
    },
  })
);
