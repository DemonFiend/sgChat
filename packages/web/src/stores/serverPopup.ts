import { createSignal, createRoot } from 'solid-js';
import { api } from '@/api';
import type { ServerPopupData } from '@sgchat/shared';

interface ServerPopupState {
    isVisible: boolean;
    currentServerId: string | null;
    serverData: ServerPopupData | null;
    isLoading: boolean;
    error: string | null;
}

// LocalStorage helper functions
const DISMISSED_KEY_PREFIX = 'serverPopup_dismissed_';

function isDismissed(serverId: string): boolean {
    try {
        const value = localStorage.getItem(`${DISMISSED_KEY_PREFIX}${serverId}`);
        return value === 'true';
    } catch {
        // If localStorage is unavailable, gracefully degrade (treat as not dismissed)
        return false;
    }
}

function markDismissed(serverId: string): void {
    try {
        localStorage.setItem(`${DISMISSED_KEY_PREFIX}${serverId}`, 'true');
    } catch {
        // If localStorage is unavailable, fail silently
        console.warn('[ServerPopup] localStorage unavailable, dismissal will not persist');
    }
}

function clearDismissed(serverId: string): void {
    try {
        localStorage.removeItem(`${DISMISSED_KEY_PREFIX}${serverId}`);
    } catch {
        // Fail silently
    }
}

// Server API response type (snake_case from backend)
interface ServerResponse {
    id: string;
    name: string;
    banner_url: string | null;
    motd: string | null;
    welcome_message: string | null;
    timezone: string;
    // ... other fields we don't need
}

// Convert server response to popup data
function mapServerToPopupData(server: ServerResponse): ServerPopupData {
    return {
        serverName: server.name,
        bannerUrl: server.banner_url,
        motd: server.motd,
        welcomeMessage: server.welcome_message,
        timezone: server.timezone || 'UTC',
    };
}

function createServerPopupStore() {
    const [state, setState] = createSignal<ServerPopupState>({
        isVisible: false,
        currentServerId: null,
        serverData: null,
        isLoading: false,
        error: null,
    });

    /**
     * Show the popup for a specific server.
     * Fetches server data from API and checks if it was previously dismissed.
     */
    const showPopup = async (serverId: string): Promise<void> => {
        // Check if already dismissed
        if (isDismissed(serverId)) {
            console.log(`[ServerPopup] Server ${serverId} popup was dismissed, not showing`);
            return;
        }

        // Set loading state
        setState({
            ...state(),
            isLoading: true,
            error: null,
            currentServerId: serverId,
        });

        try {
            // Fetch server data from API
            const server = await api.get<ServerResponse>(`/servers/${serverId}`);
            const popupData = mapServerToPopupData(server);

            // Update state with data and show popup
            setState({
                isVisible: true,
                currentServerId: serverId,
                serverData: popupData,
                isLoading: false,
                error: null,
            });
        } catch (err) {
            console.error('[ServerPopup] Failed to fetch server data:', err);

            // Set error state
            setState({
                ...state(),
                isLoading: false,
                error: err instanceof Error ? err.message : 'Failed to load server data',
            });
        }
    };

    /**
     * Hide the popup without marking it as dismissed.
     * The popup can be shown again on next login or via reopenPopup().
     */
    const hidePopup = (): void => {
        setState({
            ...state(),
            isVisible: false,
        });
    };

    /**
     * Dismiss the popup and save dismissal state to localStorage.
     * The popup will not show automatically on next login.
     */
    const dismissPopup = (): void => {
        const currentServer = state().currentServerId;

        if (currentServer) {
            markDismissed(currentServer);
        }

        setState({
            ...state(),
            isVisible: false,
        });
    };

    /**
     * Reopen the popup for the current server, regardless of dismissal state.
     * This is called when the user clicks on a server icon.
     */
    const reopenPopup = async (): Promise<void> => {
        const currentServer = state().currentServerId;

        if (!currentServer) {
            console.warn('[ServerPopup] No current server to reopen popup for');
            return;
        }

        // Clear dismissal state so it shows again
        clearDismissed(currentServer);

        // If we already have server data, just show it
        if (state().serverData) {
            setState({
                ...state(),
                isVisible: true,
            });
        } else {
            // Otherwise fetch fresh data
            await showPopup(currentServer);
        }
    };

    /**
     * Manually set server data without fetching.
     * Useful for testing or when data is already available.
     */
    const setServerData = (data: ServerPopupData): void => {
        setState({
            ...state(),
            serverData: data,
        });
    };

    /**
     * Retry loading server data after an error.
     */
    const retry = async (): Promise<void> => {
        const currentServer = state().currentServerId;

        if (currentServer) {
            await showPopup(currentServer);
        }
    };

    /**
     * Clear all state and reset the popup.
     */
    const reset = (): void => {
        setState({
            isVisible: false,
            currentServerId: null,
            serverData: null,
            isLoading: false,
            error: null,
        });
    };

    return {
        // Reactive state
        state,

        // Actions
        showPopup,
        hidePopup,
        dismissPopup,
        reopenPopup,
        setServerData,
        retry,
        reset,
    };
}

// Create the store instance in a root
export const serverPopupStore = createRoot(createServerPopupStore);
