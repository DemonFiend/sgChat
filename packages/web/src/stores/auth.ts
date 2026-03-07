import { create } from 'zustand';
import { networkStore, getEffectiveUrl } from './network';
import { encryptPassword, decryptPassword, hashPasswordForTransit } from '../lib/crypto';
import { isEncryptedPayload } from '@sgchat/shared';
import {
  ensureCryptoSession,
  encryptForTransport,
  decryptFromTransport,
  getCryptoSessionId,
  hasCryptoSession,
} from '../lib/transportCrypto';

export interface User {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  bio: string | null;
  status: 'online' | 'idle' | 'dnd' | 'offline';
  custom_status: string | null;
  custom_status_expires_at: string | null;
  created_at: string;
  permissions?: UserPermissions;
}

export interface UserPermissions {
  administrator: boolean;
  manage_server: boolean;
  manage_channels: boolean;
  manage_roles: boolean;
  kick_members: boolean;
  ban_members: boolean;
  timeout_members: boolean;
  moderate_members: boolean;
  create_invites: boolean;
  change_nickname: boolean;
  manage_nicknames: boolean;
  view_audit_log: boolean;
  view_channel: boolean;
  send_messages: boolean;
  embed_links: boolean;
  attach_files: boolean;
  add_reactions: boolean;
  mention_everyone: boolean;
  manage_messages: boolean;
  read_message_history: boolean;
  connect: boolean;
  speak: boolean;
  video: boolean;
  stream: boolean;
  mute_members: boolean;
  deafen_members: boolean;
  move_members: boolean;
  disconnect_members: boolean;
  priority_speaker: boolean;
  use_voice_activity: boolean;
  create_events: boolean;
  manage_events: boolean;
}

export type AuthErrorReason = 'session_expired' | 'server_unreachable' | 'token_invalid';

// Memory-only token storage (secure — not in localStorage)
let accessToken: string | null = null;
let tokenExpiresAt: number = 0;
let proactiveRefreshInterval: ReturnType<typeof setInterval> | null = null;
let refreshPromise: Promise<string> | null = null;

function getApiUrl(): string {
  const currentUrl = networkStore.currentUrl();
  return getEffectiveUrl(currentUrl);
}

/**
 * Encrypted fetch wrapper for auth endpoints.
 * Uses transportCrypto directly to avoid circular dependency with api/client.ts.
 */
async function encryptedFetch(
  url: string,
  init: RequestInit & { body?: string },
): Promise<Response> {
  const apiUrl = getApiUrl();
  const headers = new Headers(init.headers);

  // Establish crypto session if needed
  if (apiUrl) {
    try {
      await ensureCryptoSession(apiUrl);
    } catch {
      // Fallback to unencrypted if session negotiation fails
    }
  }

  // Encrypt body if crypto session active and body exists
  if (hasCryptoSession() && init.body) {
    const encrypted = await encryptForTransport(init.body);
    headers.set('Content-Type', 'application/json');
    headers.set('X-Crypto-Session', getCryptoSessionId()!);
    return fetch(url, { ...init, headers, body: JSON.stringify(encrypted) });
  }

  return fetch(url, { ...init, headers });
}

/** Decrypt response JSON if encrypted */
async function decryptResponseJson(response: Response): Promise<unknown> {
  const data = await response.json();
  if (isEncryptedPayload(data)) {
    const plaintext = await decryptFromTransport(data);
    return JSON.parse(plaintext);
  }
  return data;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authError: AuthErrorReason | null;
}

interface AuthActions {
  getAccessToken: () => string | null;
  login: (email: string, password: string) => Promise<User>;
  loginWithRememberMe: (email: string, password: string, rememberMe: boolean) => Promise<User>;
  register: (email: string, username: string, password: string) => Promise<User>;
  logout: (forgetDevice?: boolean) => Promise<void>;
  refreshAccessToken: () => Promise<string>;
  checkAuth: () => Promise<boolean>;
  setNotLoading: () => void;
  attemptAutoLogin: () => Promise<boolean>;
  updateStatus: (status: User['status']) => void;
  updateCustomStatus: (custom_status: string | null, expires_at?: string | null) => void;
  clearExpiredCustomStatus: () => boolean;
  refreshUser: () => Promise<User | null>;
  updateAvatarUrl: (avatar_url: string | null) => void;
  updateUser: (updates: Partial<User>) => void;
  triggerAuthError: (reason: AuthErrorReason) => void;
  clearAuthError: () => void;
}

export const useAuthStore = create<AuthState & AuthActions>((set, get) => {
  const setTokens = (token: string, expiresIn: number = 900) => {
    accessToken = token;
    tokenExpiresAt = Date.now() + expiresIn * 1000;
  };

  const clearTokens = () => {
    accessToken = null;
    tokenExpiresAt = 0;
    stopProactiveRefresh();
  };

  const startProactiveRefresh = () => {
    stopProactiveRefresh();
    proactiveRefreshInterval = setInterval(async () => {
      if (tokenExpiresAt && Date.now() > tokenExpiresAt - 120000) {
        try {
          await get().refreshAccessToken();
        } catch { /* handled in refreshAccessToken */ }
      }
    }, 60000);
  };

  const stopProactiveRefresh = () => {
    if (proactiveRefreshInterval) {
      clearInterval(proactiveRefreshInterval);
      proactiveRefreshInterval = null;
    }
  };

  return {
    user: null,
    isAuthenticated: false,
    isLoading: true,
    authError: null,

    getAccessToken: () => {
      if (accessToken && Date.now() < tokenExpiresAt - 30000) return accessToken;
      return null;
    },

    triggerAuthError: (reason) => {
      if (get().authError === null) set({ authError: reason });
    },
    clearAuthError: () => set({ authError: null }),

    login: async (email, password) => {
      const apiUrl = getApiUrl();
      if (!apiUrl) throw new Error('No network selected');
      const hashedPassword = await hashPasswordForTransit(password);
      const response = await encryptedFetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password: hashedPassword }),
      });
      if (!response.ok) {
        const error = await decryptResponseJson(response);
        throw new Error((error as any).message || 'Login failed');
      }
      const data = (await decryptResponseJson(response)) as any;
      setTokens(data.access_token, 900);
      startProactiveRefresh();
      set({ user: data.user, isAuthenticated: true, isLoading: false });
      return data.user;
    },

    loginWithRememberMe: async (email, password, rememberMe) => {
      const user = await get().login(email, password);
      const apiUrl = getApiUrl();
      if (rememberMe && apiUrl) {
        const encrypted = await encryptPassword(password);
        networkStore.saveAccountForNetwork(apiUrl, email, encrypted);
      } else if (apiUrl) {
        networkStore.saveAccountForNetwork(apiUrl, email, undefined);
      }
      return user;
    },

    register: async (email, username, password) => {
      const apiUrl = getApiUrl();
      if (!apiUrl) throw new Error('No network selected');
      const hashedPassword = await hashPasswordForTransit(password);
      const response = await encryptedFetch(`${apiUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, username, password: hashedPassword }),
      });
      if (!response.ok) {
        const error = await decryptResponseJson(response);
        throw new Error((error as any).message || 'Registration failed');
      }
      const data = (await decryptResponseJson(response)) as any;
      setTokens(data.access_token, 900);
      startProactiveRefresh();
      set({ user: data.user, isAuthenticated: true, isLoading: false });
      networkStore.saveAccountForNetwork(apiUrl, email, undefined);
      return data.user;
    },

    refreshAccessToken: async () => {
      // Short-circuit if auth error is already set
      if (get().authError) throw new Error('Session expired');

      // Dedup: if a refresh is already in-flight, all callers await the same promise
      if (refreshPromise) return refreshPromise;

      refreshPromise = (async () => {
        const apiUrl = getApiUrl();
        if (!apiUrl) throw new Error('No network selected');
        const wasAuthenticated = get().isAuthenticated || accessToken !== null;
        let response: Response;
        try {
          response = await encryptedFetch(`${apiUrl}/auth/refresh`, { method: 'POST', credentials: 'include' });
        } catch {
          clearTokens();
          set({ user: null, isAuthenticated: false, isLoading: false });
          if (wasAuthenticated) get().triggerAuthError('server_unreachable');
          throw new Error('Server unreachable');
        }
        if (!response.ok) {
          clearTokens();
          set({ user: null, isAuthenticated: false, isLoading: false });
          if (wasAuthenticated) get().triggerAuthError('session_expired');
          throw new Error('Session expired');
        }
        const data = (await decryptResponseJson(response)) as any;
        setTokens(data.access_token, 900);
        return data.access_token;
      })().finally(() => {
        refreshPromise = null;
      });

      return refreshPromise;
    },

    logout: async (forgetDevice = false) => {
      const apiUrl = getApiUrl();
      const currentUser = get().user;
      try {
        if (apiUrl) {
          await encryptedFetch(`${apiUrl}/auth/logout`, {
            method: 'POST', credentials: 'include',
            headers: { Authorization: `Bearer ${accessToken}` },
          });
        }
      } catch { /* ignore */ }
      if (forgetDevice && apiUrl && currentUser) {
        networkStore.clearStoredCredentials(apiUrl, currentUser.email);
      }
      clearTokens();
      set({ user: null, isAuthenticated: false, isLoading: false });
    },

    checkAuth: async () => {
      const apiUrl = getApiUrl();
      if (!apiUrl) { set({ user: null, isAuthenticated: false, isLoading: false }); return false; }
      set((s) => ({ ...s, isLoading: true }));
      try {
        const token = await get().refreshAccessToken();
        const response = await encryptedFetch(`${apiUrl}/users/me`, {
          headers: { Authorization: `Bearer ${token}` }, credentials: 'include',
        });
        if (!response.ok) throw new Error('Failed to fetch user');
        const user = (await decryptResponseJson(response)) as User;
        set({ user, isAuthenticated: true, isLoading: false });
        startProactiveRefresh();
        return true;
      } catch {
        set({ user: null, isAuthenticated: false, isLoading: false });
        return false;
      }
    },

    setNotLoading: () => set((s) => ({ ...s, isLoading: false })),

    attemptAutoLogin: async () => {
      const apiUrl = getApiUrl();
      if (!apiUrl) return false;
      const accounts = networkStore.getAccountsForNetwork(apiUrl);
      const account = accounts.find(
        (a) => a.encryptedPassword && a.rememberMe && !networkStore.isCredentialExpired(a)
      );
      if (!account?.encryptedPassword) return false;
      try {
        const password = await decryptPassword(account.encryptedPassword);
        await get().login(account.email, password);
        networkStore.saveAccountForNetwork(apiUrl, account.email, account.encryptedPassword);
        return true;
      } catch (error) {
        console.error('Auto-login failed:', error);
        networkStore.clearStoredCredentials(apiUrl, account.email);
        return false;
      }
    },

    updateStatus: (status) => set((s) => ({ ...s, user: s.user ? { ...s.user, status } : null })),
    updateCustomStatus: (custom_status, expires_at) => set((s) => ({
      ...s, user: s.user ? { ...s.user, custom_status, custom_status_expires_at: expires_at ?? null } : null,
    })),
    clearExpiredCustomStatus: () => {
      const user = get().user;
      if (user?.custom_status_expires_at && new Date(user.custom_status_expires_at) <= new Date()) {
        set((s) => ({ ...s, user: s.user ? { ...s.user, custom_status: null, custom_status_expires_at: null } : null }));
        return true;
      }
      return false;
    },
    refreshUser: async () => {
      const apiUrl = getApiUrl();
      const token = get().getAccessToken();
      if (!apiUrl || !token) return null;
      try {
        const response = await encryptedFetch(`${apiUrl}/users/me`, {
          headers: { Authorization: `Bearer ${token}` }, credentials: 'include',
        });
        if (!response.ok) return null;
        const user = (await decryptResponseJson(response)) as User;
        set((s) => ({ ...s, user }));
        return user;
      } catch { return null; }
    },
    updateAvatarUrl: (avatar_url) => set((s) => ({ ...s, user: s.user ? { ...s.user, avatar_url } : null })),
    updateUser: (updates) => set((s) => ({ ...s, user: s.user ? { ...s.user, ...updates } : null })),
  };
});

// Convenience alias for non-hook contexts (API client, socket service)
export const authStore = {
  getState: () => useAuthStore.getState(),
  state: () => {
    const s = useAuthStore.getState();
    return { user: s.user, isAuthenticated: s.isAuthenticated, isLoading: s.isLoading };
  },
  authError: () => useAuthStore.getState().authError,
  getAccessToken: () => useAuthStore.getState().getAccessToken(),
  refreshAccessToken: () => useAuthStore.getState().refreshAccessToken(),
  loginWithRememberMe: (email: string, password: string, rememberMe: boolean) =>
    useAuthStore.getState().loginWithRememberMe(email, password, rememberMe),
  register: (email: string, username: string, password: string) =>
    useAuthStore.getState().register(email, username, password),
  logout: (forgetDevice?: boolean) => useAuthStore.getState().logout(forgetDevice),
  checkAuth: () => useAuthStore.getState().checkAuth(),
  attemptAutoLogin: () => useAuthStore.getState().attemptAutoLogin(),
  triggerAuthError: (reason: AuthErrorReason) => useAuthStore.getState().triggerAuthError(reason),
  updateStatus: (status: User['status']) => useAuthStore.getState().updateStatus(status),
  updateCustomStatus: (custom_status: string | null, expires_at?: string | null) =>
    useAuthStore.getState().updateCustomStatus(custom_status, expires_at),
  refreshUser: () => useAuthStore.getState().refreshUser(),
};
