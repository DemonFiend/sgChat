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
        console.log('[ServerPopup] showPopup called for server:', serverId);
        
        // Check if already dismissed
        const dismissed = isDismissed(serverId);
        console.log('[ServerPopup] Dismissal check:', { serverId, dismissed, 
            localStorageKey: `${DISMISSED_KEY_PREFIX}${serverId}`,
            localStorageValue: localStorage.getItem(`${DISMISSED_KEY_PREFIX}${serverId}`)
        });
        
        if (dismissed) {
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
            console.log('[ServerPopup] Fetching popup data from /server/popup-config/data');
            // Fetch popup data from the new config endpoint
            // This endpoint returns the admin-configured popup data
            const popupData = await api.get<ServerPopupData>('/server/popup-config/data');
            console.log('[ServerPopup] Popup data received:', popupData);

            // Update state with data and show popup
            setState({
                isVisible: true,
                currentServerId: serverId,
                serverData: popupData,
                isLoading: false,
                error: null,
            });
            console.log('[ServerPopup] Popup state set to visible');
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
        console.log('[ServerPopup] reopenPopup called');
        const currentServer = state().currentServerId;

        if (!currentServer) {
            console.warn('[ServerPopup] No current server to reopen popup for, fetching from DOM/state');
            // Try to get server ID from the current user context
            // This will be set by the main layout when server loads
            return;
        }

        console.log('[ServerPopup] Reopening popup for server:', currentServer);
        
        // Clear dismissal state so it shows again
        clearDismissed(currentServer);
        console.log('[ServerPopup] Cleared dismissal state');

        // If we already have server data, just show it
        if (state().serverData) {
            console.log('[ServerPopup] Using cached server data, showing popup');
            setState({
                ...state(),
                isVisible: true,
            });
        } else {
            // Otherwise fetch fresh data
            console.log('[ServerPopup] No cached data, fetching fresh');
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
