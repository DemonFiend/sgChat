import { createSignal, createRoot } from 'solid-js';
import type { EncryptedCredential } from '../lib/crypto';

export type { EncryptedCredential } from '../lib/crypto';

export interface NetworkAccount {
  email: string;
  lastUsed: string; // ISO date
  encryptedPassword?: EncryptedCredential; // Only present if "Remember me" was checked
  rememberMe?: boolean;
  storedAt?: string; // ISO date - when credentials were stored (for TTL)
}

export interface Network {
  url: string;
  name: string; // Server name from /health or user-set
  accounts: NetworkAccount[]; // Multiple accounts per network
  lastConnected: string | null; // ISO date
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

/**
 * Get the effective API URL for making requests.
 * When served from the same origin as the API (production), use relative '/api' path.
 * When connecting to an external server, use the full URL.
 * @param inputUrl - The user-entered or stored server URL
 * @returns The effective URL to use for API calls
 */
export function getEffectiveUrl(inputUrl: string | null): string {
  if (!inputUrl) return '/api'; // Default: same-origin API

  // Normalize the URL (remove trailing slash)
  const normalized = inputUrl.replace(/\/+$/, '');

  // If the URL points to the current origin, use the proxied /api path
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

function createNetworkStore() {
  // Load initial state from localStorage
  const initialNetworks = loadFromStorage<Network[]>(STORAGE_KEYS.networks, []);
  const initialAutoLogin = loadFromStorage<boolean>(STORAGE_KEYS.autoLogin, false);
  const initialLastUrl = loadFromStorage<string | null>(STORAGE_KEYS.lastNetworkUrl, null);

  // Signals
  const [networks, setNetworks] = createSignal<Network[]>(initialNetworks);
  const [autoLogin, setAutoLoginSignal] = createSignal(initialAutoLogin);
  const [currentUrl, setCurrentUrl] = createSignal<string | null>(initialLastUrl);
  const [connectionStatus, setConnectionStatus] = createSignal<ConnectionStatus>('idle');
  const [serverInfo, setServerInfo] = createSignal<ServerInfo | null>(null);
  const [connectionError, setConnectionError] = createSignal<string | null>(null);

  // Derived state
  const currentNetwork = () => networks().find((n) => n.url === currentUrl()) || null;
  const defaultNetwork = () => networks().find((n) => n.isDefault) || null;
  const favoriteNetworks = () => networks().filter((n) => n.isFavorite);
  const recentNetworks = () =>
    networks()
      .filter((n) => !n.isFavorite && n.lastConnected)
      .sort((a, b) => {
        if (!a.lastConnected) return 1;
        if (!b.lastConnected) return -1;
        return new Date(b.lastConnected).getTime() - new Date(a.lastConnected).getTime();
      })
      .slice(0, MAX_RECENT_NETWORKS);

  // Persist networks whenever they change
  const persistNetworks = (newNetworks: Network[]) => {
    setNetworks(newNetworks);
    saveToStorage(STORAGE_KEYS.networks, newNetworks);
  };

  // Test connection to a network
  const testConnection = async (url: string): Promise<ServerInfo | null> => {
    setConnectionStatus('testing');
    setConnectionError(null);
    setServerInfo(null);

    // Normalize URL (remove trailing slash) - this is the "display" URL stored
    const normalizedUrl = url.replace(/\/+$/, '');
    // Use effective URL for actual API calls (handles proxy routing)
    const effectiveUrl = getEffectiveUrl(normalizedUrl);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(`${effectiveUrl}/health`, {
        signal: controller.signal,
        credentials: 'include',
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();
      
      if (data.status !== 'ok') {
        throw new Error('Server health check failed');
      }

      const info: ServerInfo = {
        name: data.name || 'Unknown Server',
        version: data.version || 'Unknown',
        status: data.status,
      };

      setServerInfo(info);
      setConnectionStatus('connected');
      setCurrentUrl(normalizedUrl);
      saveToStorage(STORAGE_KEYS.lastNetworkUrl, normalizedUrl);

      return info;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      setConnectionError(message.includes('abort') ? 'Connection timed out' : message);
      setConnectionStatus('failed');
      return null;
    }
  };

  // Add or update a network
  const addOrUpdateNetwork = (url: string, updates: Partial<Omit<Network, 'url'>>) => {
    const normalizedUrl = url.replace(/\/+$/, '');
    const existing = networks().find((n) => n.url === normalizedUrl);

    if (existing) {
      // Update existing
      persistNetworks(
        networks().map((n) =>
          n.url === normalizedUrl ? { ...n, ...updates } : n
        )
      );
    } else {
      // Add new network
      const newNetwork: Network = {
        url: normalizedUrl,
        name: updates.name || serverInfo()?.name || 'Unknown Server',
        accounts: updates.accounts || [],
        lastConnected: updates.lastConnected || null,
        isFavorite: updates.isFavorite || false,
        isDefault: updates.isDefault || false,
      };

      // If setting as default, clear other defaults
      let updatedNetworks = networks();
      if (newNetwork.isDefault) {
        updatedNetworks = updatedNetworks.map((n) => ({ ...n, isDefault: false }));
      }

      persistNetworks([...updatedNetworks, newNetwork]);
    }
  };

  // Check if stored credentials have expired
  const isCredentialExpired = (account: NetworkAccount): boolean => {
    if (!account.storedAt || !account.encryptedPassword) return true;
    const storedDate = new Date(account.storedAt).getTime();
    const now = Date.now();
    const ttlMs = CREDENTIAL_TTL_DAYS * 24 * 60 * 60 * 1000;
    return now - storedDate > ttlMs;
  };

  // Save email for a network (for account history)
  const saveAccountForNetwork = (
    url: string,
    email: string,
    encryptedPassword?: EncryptedCredential
  ) => {
    const normalizedUrl = url.replace(/\/+$/, '');
    const network = networks().find((n) => n.url === normalizedUrl);
    const now = new Date().toISOString();

    const newAccount: NetworkAccount = {
      email,
      lastUsed: now,
      encryptedPassword,
      rememberMe: !!encryptedPassword,
      storedAt: encryptedPassword ? now : undefined,
    };

    if (!network) {
      // Create new network entry
      addOrUpdateNetwork(normalizedUrl, {
        name: serverInfo()?.name || 'Unknown Server',
        accounts: [newAccount],
        lastConnected: now,
      });
      return;
    }

    // Update existing network's accounts
    const existingAccount = network.accounts.find((a) => a.email === email);
    let updatedAccounts: NetworkAccount[];

    if (existingAccount) {
      // Preserve existing credentials if not provided new ones
      const updatedAccount: NetworkAccount = {
        ...newAccount,
        encryptedPassword: encryptedPassword ?? existingAccount.encryptedPassword,
        rememberMe: encryptedPassword !== undefined ? !!encryptedPassword : existingAccount.rememberMe,
        storedAt: encryptedPassword ? now : existingAccount.storedAt,
      };
      updatedAccounts = [
        updatedAccount,
        ...network.accounts.filter((a) => a.email !== email),
      ];
    } else {
      // Add new account at front
      updatedAccounts = [
        newAccount,
        ...network.accounts,
      ].slice(0, MAX_ACCOUNTS_PER_NETWORK);
    }

    persistNetworks(
      networks().map((n) =>
        n.url === normalizedUrl
          ? { ...n, accounts: updatedAccounts, lastConnected: new Date().toISOString() }
          : n
      )
    );
  };

  // Toggle favorite
  const toggleFavorite = (url: string) => {
    const normalizedUrl = url.replace(/\/+$/, '');
    persistNetworks(
      networks().map((n) =>
        n.url === normalizedUrl ? { ...n, isFavorite: !n.isFavorite } : n
      )
    );
  };

  // Set as default
  const setAsDefault = (url: string | null) => {
    if (!url) {
      // Clear default
      persistNetworks(networks().map((n) => ({ ...n, isDefault: false })));
      return;
    }

    const normalizedUrl = url.replace(/\/+$/, '');
    persistNetworks(
      networks().map((n) => ({
        ...n,
        isDefault: n.url === normalizedUrl,
      }))
    );
  };

  // Remove network from history
  const removeNetwork = (url: string) => {
    const normalizedUrl = url.replace(/\/+$/, '');
    persistNetworks(networks().filter((n) => n.url !== normalizedUrl));
  };

  // Set auto-login preference
  const setAutoLogin = (enabled: boolean) => {
    setAutoLoginSignal(enabled);
    saveToStorage(STORAGE_KEYS.autoLogin, enabled);
  };

  // Get accounts for current network
  const getAccountsForNetwork = (url: string) => {
    const normalizedUrl = url.replace(/\/+$/, '');
    return networks().find((n) => n.url === normalizedUrl)?.accounts || [];
  };

  // Clear connection state (for logout)
  const clearConnection = () => {
    setCurrentUrl(null);
    setServerInfo(null);
    setConnectionStatus('idle');
    setConnectionError(null);
    saveToStorage(STORAGE_KEYS.lastNetworkUrl, null);
  };

  // Clear stored credentials for a specific account
  const clearStoredCredentials = (url: string, email: string) => {
    const normalizedUrl = url.replace(/\/+$/, '');
    persistNetworks(
      networks().map((n) =>
        n.url === normalizedUrl
          ? {
              ...n,
              accounts: n.accounts.map((a) =>
                a.email === email
                  ? { ...a, encryptedPassword: undefined, rememberMe: false, storedAt: undefined }
                  : a
              ),
            }
          : n
      )
    );
  };

  // Clear all stored credentials across all networks
  const clearAllStoredCredentials = () => {
    persistNetworks(
      networks().map((n) => ({
        ...n,
        accounts: n.accounts.map((a) => ({
          ...a,
          encryptedPassword: undefined,
          rememberMe: false,
          storedAt: undefined,
        })),
      }))
    );
  };

  return {
    // State
    networks,
    currentUrl,
    currentNetwork,
    defaultNetwork,
    favoriteNetworks,
    recentNetworks,
    connectionStatus,
    serverInfo,
    connectionError,
    autoLogin,

    // Actions
    testConnection,
    addOrUpdateNetwork,
    saveAccountForNetwork,
    toggleFavorite,
    setAsDefault,
    removeNetwork,
    setAutoLogin,
    getAccountsForNetwork,
    clearConnection,
    setCurrentUrl,
    isCredentialExpired,
    clearStoredCredentials,
    clearAllStoredCredentials,
  };
}

export const networkStore = createRoot(createNetworkStore);
