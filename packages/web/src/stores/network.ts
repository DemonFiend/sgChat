import { create } from 'zustand';
import type { EncryptedCredential } from '../lib/crypto';

export type { EncryptedCredential } from '../lib/crypto';

export interface NetworkAccount {
  email: string;
  lastUsed: string;
  encryptedPassword?: EncryptedCredential;
  rememberMe?: boolean;
  storedAt?: string;
}

export interface Network {
  url: string;
  name: string;
  accounts: NetworkAccount[];
  lastConnected: string | null;
  isFavorite: boolean;
  isDefault: boolean;
}

export interface ServerInfo {
  name: string;
  version: string;
  status: string;
}

export type ConnectionStatus = 'idle' | 'testing' | 'connected' | 'failed';

const STORAGE_KEYS = {
  networks: 'sgchat-networks',
  autoLogin: 'sgchat-auto-login',
  lastNetworkUrl: 'sgchat-last-network',
};

const MAX_RECENT_NETWORKS = 10;
const MAX_ACCOUNTS_PER_NETWORK = 5;
const CREDENTIAL_TTL_DAYS = 30;

export function getEffectiveUrl(inputUrl: string | null): string {
  if (!inputUrl) return '/api';
  const normalized = inputUrl.replace(/\/+$/, '');
  if (typeof window !== 'undefined') {
    try {
      const inputOrigin = new URL(normalized).origin;
      if (inputOrigin === window.location.origin) {
        return '/api';
      }
    } catch {
      // Not a valid URL, treat as path
    }
  }
  return normalized;
}

function loadFromStorage<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function saveToStorage<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error('Failed to save to localStorage:', err);
  }
}

interface NetworkState {
  networks: Network[];
  autoLogin: boolean;
  currentUrl: string | null;
  connectionStatus: ConnectionStatus;
  serverInfo: ServerInfo | null;
  connectionError: string | null;
}

interface NetworkActions {
  currentNetwork: () => Network | null;
  defaultNetwork: () => Network | null;
  favoriteNetworks: () => Network[];
  recentNetworks: () => Network[];
  testConnection: (url: string) => Promise<ServerInfo | null>;
  addOrUpdateNetwork: (url: string, updates: Partial<Omit<Network, 'url'>>) => void;
  saveAccountForNetwork: (url: string, email: string, encryptedPassword?: EncryptedCredential) => void;
  toggleFavorite: (url: string) => void;
  setAsDefault: (url: string | null) => void;
  removeNetwork: (url: string) => void;
  setAutoLogin: (enabled: boolean) => void;
  getAccountsForNetwork: (url: string) => NetworkAccount[];
  clearConnection: () => void;
  setCurrentUrl: (url: string | null) => void;
  isCredentialExpired: (account: NetworkAccount) => boolean;
  clearStoredCredentials: (url: string, email: string) => void;
  clearAllStoredCredentials: () => void;
}

export const useNetworkStore = create<NetworkState & NetworkActions>((set, get) => {
  const persistNetworks = (newNetworks: Network[]) => {
    set({ networks: newNetworks });
    saveToStorage(STORAGE_KEYS.networks, newNetworks);
  };

  return {
    networks: loadFromStorage<Network[]>(STORAGE_KEYS.networks, []),
    autoLogin: loadFromStorage<boolean>(STORAGE_KEYS.autoLogin, false),
    currentUrl: loadFromStorage<string | null>(STORAGE_KEYS.lastNetworkUrl, null),
    connectionStatus: 'idle',
    serverInfo: null,
    connectionError: null,

    currentNetwork: () => {
      const { networks, currentUrl } = get();
      return networks.find((n) => n.url === currentUrl) || null;
    },
    defaultNetwork: () => get().networks.find((n) => n.isDefault) || null,
    favoriteNetworks: () => get().networks.filter((n) => n.isFavorite),
    recentNetworks: () =>
      get().networks
        .filter((n) => !n.isFavorite && n.lastConnected)
        .sort((a, b) => {
          if (!a.lastConnected) return 1;
          if (!b.lastConnected) return -1;
          return new Date(b.lastConnected).getTime() - new Date(a.lastConnected).getTime();
        })
        .slice(0, MAX_RECENT_NETWORKS),

    testConnection: async (url) => {
      set({ connectionStatus: 'testing', connectionError: null, serverInfo: null });
      const normalizedUrl = url.replace(/\/+$/, '');
      const effectiveUrl = getEffectiveUrl(normalizedUrl);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(`${effectiveUrl}/health`, {
          signal: controller.signal,
          credentials: 'include',
        });
        clearTimeout(timeout);
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        const data = await response.json();
        if (data.status !== 'ok') throw new Error('Server health check failed');
        const info: ServerInfo = {
          name: data.name || 'Unknown Server',
          version: data.version || 'Unknown',
          status: data.status,
        };
        set({ serverInfo: info, connectionStatus: 'connected', currentUrl: normalizedUrl });
        saveToStorage(STORAGE_KEYS.lastNetworkUrl, normalizedUrl);
        return info;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Connection failed';
        set({
          connectionError: message.includes('abort') ? 'Connection timed out' : message,
          connectionStatus: 'failed',
        });
        return null;
      }
    },

    addOrUpdateNetwork: (url, updates) => {
      const normalizedUrl = url.replace(/\/+$/, '');
      const { networks, serverInfo } = get();
      const existing = networks.find((n) => n.url === normalizedUrl);
      if (existing) {
        persistNetworks(networks.map((n) => (n.url === normalizedUrl ? { ...n, ...updates } : n)));
      } else {
        const newNetwork: Network = {
          url: normalizedUrl,
          name: updates.name || serverInfo?.name || 'Unknown Server',
          accounts: updates.accounts || [],
          lastConnected: updates.lastConnected || null,
          isFavorite: updates.isFavorite || false,
          isDefault: updates.isDefault || false,
        };
        let updatedNetworks = networks;
        if (newNetwork.isDefault) {
          updatedNetworks = updatedNetworks.map((n) => ({ ...n, isDefault: false }));
        }
        persistNetworks([...updatedNetworks, newNetwork]);
      }
    },

    isCredentialExpired: (account) => {
      if (!account.storedAt || !account.encryptedPassword) return true;
      const storedDate = new Date(account.storedAt).getTime();
      const ttlMs = CREDENTIAL_TTL_DAYS * 24 * 60 * 60 * 1000;
      return Date.now() - storedDate > ttlMs;
    },

    saveAccountForNetwork: (url, email, encryptedPassword?) => {
      const normalizedUrl = url.replace(/\/+$/, '');
      const { networks, serverInfo } = get();
      const network = networks.find((n) => n.url === normalizedUrl);
      const now = new Date().toISOString();
      const newAccount: NetworkAccount = {
        email, lastUsed: now, encryptedPassword,
        rememberMe: !!encryptedPassword,
        storedAt: encryptedPassword ? now : undefined,
      };
      if (!network) {
        get().addOrUpdateNetwork(normalizedUrl, {
          name: serverInfo?.name || 'Unknown Server',
          accounts: [newAccount], lastConnected: now,
        });
        return;
      }
      const existingAccount = network.accounts.find((a) => a.email === email);
      let updatedAccounts: NetworkAccount[];
      if (existingAccount) {
        updatedAccounts = [
          { ...newAccount,
            encryptedPassword: encryptedPassword ?? existingAccount.encryptedPassword,
            rememberMe: encryptedPassword !== undefined ? !!encryptedPassword : existingAccount.rememberMe,
            storedAt: encryptedPassword ? now : existingAccount.storedAt,
          },
          ...network.accounts.filter((a) => a.email !== email),
        ];
      } else {
        updatedAccounts = [newAccount, ...network.accounts].slice(0, MAX_ACCOUNTS_PER_NETWORK);
      }
      persistNetworks(
        networks.map((n) =>
          n.url === normalizedUrl
            ? { ...n, accounts: updatedAccounts, lastConnected: new Date().toISOString() }
            : n
        )
      );
    },

    toggleFavorite: (url) => {
      const normalizedUrl = url.replace(/\/+$/, '');
      persistNetworks(get().networks.map((n) => n.url === normalizedUrl ? { ...n, isFavorite: !n.isFavorite } : n));
    },
    setAsDefault: (url) => {
      if (!url) { persistNetworks(get().networks.map((n) => ({ ...n, isDefault: false }))); return; }
      const normalizedUrl = url.replace(/\/+$/, '');
      persistNetworks(get().networks.map((n) => ({ ...n, isDefault: n.url === normalizedUrl })));
    },
    removeNetwork: (url) => {
      persistNetworks(get().networks.filter((n) => n.url !== url.replace(/\/+$/, '')));
    },
    setAutoLogin: (enabled) => { set({ autoLogin: enabled }); saveToStorage(STORAGE_KEYS.autoLogin, enabled); },
    getAccountsForNetwork: (url) => get().networks.find((n) => n.url === url.replace(/\/+$/, ''))?.accounts || [],
    clearConnection: () => {
      set({ currentUrl: null, serverInfo: null, connectionStatus: 'idle', connectionError: null });
      saveToStorage(STORAGE_KEYS.lastNetworkUrl, null);
    },
    setCurrentUrl: (url) => set({ currentUrl: url }),
    clearStoredCredentials: (url, email) => {
      const normalizedUrl = url.replace(/\/+$/, '');
      persistNetworks(get().networks.map((n) =>
        n.url === normalizedUrl
          ? { ...n, accounts: n.accounts.map((a) => a.email === email ? { ...a, encryptedPassword: undefined, rememberMe: false, storedAt: undefined } : a) }
          : n
      ));
    },
    clearAllStoredCredentials: () => {
      persistNetworks(get().networks.map((n) => ({
        ...n, accounts: n.accounts.map((a) => ({ ...a, encryptedPassword: undefined, rememberMe: false, storedAt: undefined })),
      })));
    },
  };
});

// Convenience alias for non-hook contexts (API client, socket service)
export const networkStore = {
  getState: () => useNetworkStore.getState(),
  currentUrl: () => useNetworkStore.getState().currentUrl,
  connectionStatus: () => useNetworkStore.getState().connectionStatus,
  serverInfo: () => useNetworkStore.getState().serverInfo,
  getAccountsForNetwork: (url: string) => useNetworkStore.getState().getAccountsForNetwork(url),
  isCredentialExpired: (account: NetworkAccount) => useNetworkStore.getState().isCredentialExpired(account),
  saveAccountForNetwork: (url: string, email: string, encryptedPassword?: EncryptedCredential) =>
    useNetworkStore.getState().saveAccountForNetwork(url, email, encryptedPassword),
  addOrUpdateNetwork: (url: string, updates: Partial<Omit<Network, 'url'>>) =>
    useNetworkStore.getState().addOrUpdateNetwork(url, updates),
  clearStoredCredentials: (url: string, email: string) =>
    useNetworkStore.getState().clearStoredCredentials(url, email),
  testConnection: (url: string) => useNetworkStore.getState().testConnection(url),
  autoLogin: () => useNetworkStore.getState().autoLogin,
  defaultNetwork: () => useNetworkStore.getState().defaultNetwork(),
};
