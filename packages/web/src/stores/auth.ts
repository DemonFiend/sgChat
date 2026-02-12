import { createSignal, createRoot } from 'solid-js';
import { networkStore, getEffectiveUrl } from './network';
import { encryptPassword, decryptPassword, hashPasswordForTransit } from '../lib/crypto';

export interface User {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  status: 'online' | 'idle' | 'dnd' | 'offline';
  custom_status: string | null;
  custom_status_expires_at: string | null; // ISO date string for expiration
  created_at: string;
  permissions?: UserPermissions;
}

// Named boolean permissions (not bitmasks)
export interface UserPermissions {
  administrator: boolean;
  manage_server: boolean;
  manage_channels: boolean;
  manage_roles: boolean;
  kick_members: boolean;
  ban_members: boolean;
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
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// Memory-only token storage (secure - not in localStorage)
let accessToken: string | null = null;
let tokenExpiresAt: number = 0;

/**
 * Get the effective API URL for auth requests.
 * Uses getEffectiveUrl to handle proxy routing for same-origin cookie flow.
 */
function getApiUrl(): string {
  const currentUrl = networkStore.currentUrl();
  return getEffectiveUrl(currentUrl);
}

function createAuthStore() {
  const [state, setState] = createSignal<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });

  const getAccessToken = (): string | null => {
    // Check if token is expired (with 30s buffer)
    if (accessToken && Date.now() < tokenExpiresAt - 30000) {
      return accessToken;
    }
    return null;
  };

  const setTokens = (token: string, expiresIn: number = 900) => {
    accessToken = token;
    tokenExpiresAt = Date.now() + expiresIn * 1000;
  };

  const clearTokens = () => {
    accessToken = null;
    tokenExpiresAt = 0;
  };

  const login = async (email: string, password: string): Promise<User> => {
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      throw new Error('No network selected');
    }

    // Hash password client-side so plaintext never appears in network requests
    const hashedPassword = await hashPasswordForTransit(password);

    const response = await fetch(`${apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password: hashedPassword }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Login failed');
    }

    const data = await response.json();
    setTokens(data.access_token, 900); // 15 min

    setState({
      user: data.user,
      isAuthenticated: true,
      isLoading: false,
    });

    return data.user;
  };

  /**
   * Login with optional "Remember me" - encrypts and stores credentials
   */
  const loginWithRememberMe = async (
    email: string,
    password: string,
    rememberMe: boolean
  ): Promise<User> => {
    const user = await login(email, password);
    const apiUrl = getApiUrl();

    if (rememberMe && apiUrl) {
      // Encrypt and store credentials
      const encrypted = await encryptPassword(password);
      networkStore.saveAccountForNetwork(apiUrl, email, encrypted);
    } else if (apiUrl) {
      // Just save email without credentials
      networkStore.saveAccountForNetwork(apiUrl, email, undefined);
    }

    return user;
  };

  const register = async (
    email: string,
    username: string,
    password: string
  ): Promise<User> => {
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      throw new Error('No network selected');
    }

    // Hash password client-side so plaintext never appears in network requests
    const hashedPassword = await hashPasswordForTransit(password);

    const response = await fetch(`${apiUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, username, password: hashedPassword }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Registration failed');
    }

    const data = await response.json();
    setTokens(data.access_token, 900);

    setState({
      user: data.user,
      isAuthenticated: true,
      isLoading: false,
    });

    // Save the email for this network (no password stored on register)
    networkStore.saveAccountForNetwork(apiUrl, email, undefined);

    return data.user;
  };

  const refreshAccessToken = async (): Promise<string> => {
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      throw new Error('No network selected');
    }

    const response = await fetch(`${apiUrl}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) {
      clearTokens();
      setState({ user: null, isAuthenticated: false, isLoading: false });
      throw new Error('Session expired');
    }

    const data = await response.json();
    setTokens(data.access_token, 900);
    return data.access_token;
  };

  const logout = async (forgetDevice: boolean = false) => {
    const apiUrl = getApiUrl();
    const currentUser = state().user;
    
    try {
      if (apiUrl) {
        await fetch(`${apiUrl}/auth/logout`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
      }
    } catch {
      // Ignore errors on logout
    }

    // Clear stored credentials if "forget device" is checked
    if (forgetDevice && apiUrl && currentUser) {
      networkStore.clearStoredCredentials(apiUrl, currentUser.email);
    }

    clearTokens();
    setState({ user: null, isAuthenticated: false, isLoading: false });
  };

  const checkAuth = async (): Promise<boolean> => {
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      setState({ user: null, isAuthenticated: false, isLoading: false });
      return false;
    }

    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const token = await refreshAccessToken();

      // Fetch current user
      const response = await fetch(`${apiUrl}/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch user');
      }

      const user = await response.json();
      setState({ user, isAuthenticated: true, isLoading: false });
      return true;
    } catch {
      setState({ user: null, isAuthenticated: false, isLoading: false });
      return false;
    }
  };

  // Set loading to false initially (will be set to true when checking auth)
  const setNotLoading = () => {
    setState((prev) => ({ ...prev, isLoading: false }));
  };

  /**
   * Attempt auto-login using stored credentials
   * Returns true if successful, false otherwise
   */
  const attemptAutoLogin = async (): Promise<boolean> => {
    const apiUrl = getApiUrl();
    if (!apiUrl) return false;

    const accounts = networkStore.getAccountsForNetwork(apiUrl);
    // Find first account with valid (non-expired) stored credentials
    const accountWithCreds = accounts.find(
      (a) => a.encryptedPassword && a.rememberMe && !networkStore.isCredentialExpired(a)
    );

    if (!accountWithCreds || !accountWithCreds.encryptedPassword) {
      return false;
    }

    try {
      const password = await decryptPassword(accountWithCreds.encryptedPassword);
      await login(accountWithCreds.email, password);
      // Update lastUsed without changing credentials
      networkStore.saveAccountForNetwork(apiUrl, accountWithCreds.email, accountWithCreds.encryptedPassword);
      return true;
    } catch (error) {
      console.error('Auto-login failed:', error);
      // Clear corrupted/invalid credentials
      networkStore.clearStoredCredentials(apiUrl, accountWithCreds.email);
      return false;
    }
  };

  // Update user status locally
  const updateStatus = (status: User['status']) => {
    setState(prev => ({
      ...prev,
      user: prev.user ? { ...prev.user, status } : null
    }));
  };

  // Update custom status locally
  const updateCustomStatus = (custom_status: string | null, expires_at?: string | null) => {
    setState(prev => ({
      ...prev,
      user: prev.user ? { 
        ...prev.user, 
        custom_status,
        custom_status_expires_at: expires_at ?? null
      } : null
    }));
  };

  // Check and clear expired custom status
  const clearExpiredCustomStatus = () => {
    const currentUser = state().user;
    if (currentUser?.custom_status_expires_at) {
      const expiresAt = new Date(currentUser.custom_status_expires_at);
      if (expiresAt <= new Date()) {
        setState(prev => ({
          ...prev,
          user: prev.user ? { 
            ...prev.user, 
            custom_status: null,
            custom_status_expires_at: null 
          } : null
        }));
        return true; // Was expired and cleared
      }
    }
    return false; // Not expired
  };

  return {
    state,
    getAccessToken,
    login,
    loginWithRememberMe,
    register,
    logout,
    refreshAccessToken,
    checkAuth,
    setNotLoading,
    attemptAutoLogin,
    updateStatus,
    updateCustomStatus,
    clearExpiredCustomStatus,
  };
}

// Create singleton store
export const authStore = createRoot(createAuthStore);
