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
const LAST_SHOWN_KEY_PREFIX = 'serverPopup_lastShown_';
const DISMISSED_KEY_PREFIX = 'serverPopup_dismissed_'; // Legacy - for migration only
const SHOW_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if popup should be shown based on 24-hour interval.
 * Returns true if never shown, or if 24+ hours have passed since last show.
 */
function shouldShowPopup(serverId: string): boolean {
    try {
        // Check for new timestamp-based key
        const lastShownStr = localStorage.getItem(`${LAST_SHOWN_KEY_PREFIX}${serverId}`);

        if (!lastShownStr) {
            // Check for legacy dismissal key (migrate if found)
            const legacyDismissed = localStorage.getItem(`${DISMISSED_KEY_PREFIX}${serverId}`);
            if (legacyDismissed === 'true') {
                // Migrate: treat as shown 25 hours ago (will show immediately once)
                const migratedTimestamp = Date.now() - (25 * 60 * 60 * 1000);
                localStorage.setItem(`${LAST_SHOWN_KEY_PREFIX}${serverId}`, migratedTimestamp.toString());
                localStorage.removeItem(`${DISMISSED_KEY_PREFIX}${serverId}`);
                console.log('[ServerPopup] Migrated legacy dismissal to timestamp');
                return true; // Show after migration
            }

            // Never shown before
            return true;
        }

        const lastShownTimestamp = parseInt(lastShownStr, 10);
        const now = Date.now();
        const timeSinceLastShown = now - lastShownTimestamp;

        const should = timeSinceLastShown >= SHOW_INTERVAL_MS;
        console.log('[ServerPopup] Time check:', {
            lastShown: new Date(lastShownTimestamp).toISOString(),
            now: new Date(now).toISOString(),
            hoursSince: (timeSinceLastShown / (60 * 60 * 1000)).toFixed(2),
            shouldShow: should
        });

        return should;
    } catch (err) {
        console.warn('[ServerPopup] Error checking show interval:', err);
        // If localStorage is unavailable, gracefully degrade (show popup)
        return true;
    }
}

/**
 * Mark popup as shown (save current timestamp).
 * This prevents it from showing again for 24 hours.
 */
function markAsShown(serverId: string): void {
    try {
        const now = Date.now();
        localStorage.setItem(`${LAST_SHOWN_KEY_PREFIX}${serverId}`, now.toString());
        console.log('[ServerPopup] Marked as shown at:', new Date(now).toISOString());
    } catch (err) {
        // If localStorage is unavailable, fail silently
        console.warn('[ServerPopup] localStorage unavailable, timestamp will not persist:', err);
    }
}

/**
 * Clear the last shown timestamp (for manual reopen).
 * This allows the popup to be shown again immediately.
 */
function clearLastShown(serverId: string): void {
    try {
        localStorage.removeItem(`${LAST_SHOWN_KEY_PREFIX}${serverId}`);
        // Also remove legacy key if present
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
     * Fetches server data from API and checks if it should be shown based on 24-hour interval.
     */
    const showPopup = async (serverId: string): Promise<void> => {
        console.log('[ServerPopup] showPopup called for server:', serverId);

        // Check if popup should be shown (24-hour interval check)
        const should = shouldShowPopup(serverId);
        console.log('[ServerPopup] Should show check:', {
            serverId,
            shouldShow: should
        });

        if (!should) {
            console.log(`[ServerPopup] Server ${serverId} popup shown within last 24 hours, not showing`);
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

            // Mark as shown before displaying (to start the 24h timer)
            markAsShown(serverId);

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
     * Hide the popup without updating the timestamp.
     * The popup timing is not affected - it won't show again until 24 hours from initial display.
     */
    const hidePopup = (): void => {
        setState({
            ...state(),
            isVisible: false,
        });
    };

    /**
     * Dismiss the popup and hide it.
     * The timestamp is already saved when the popup was shown,
     * so no additional action needed here (popup won't show for 24 hours).
     */
    const dismissPopup = (): void => {
        // Just hide the popup - timestamp was already saved when shown
        setState({
            ...state(),
            isVisible: false,
        });
    };

    /**
     * Reopen the popup for the current server, regardless of 24-hour interval.
     * This is called when the user manually wants to see the popup (e.g., clicks server icon).
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

        // Clear the timestamp so it can be shown again
        clearLastShown(currentServer);
        console.log('[ServerPopup] Cleared last shown timestamp');

        // If we already have server data, just show it
        if (state().serverData) {
            console.log('[ServerPopup] Using cached server data, showing popup');
            // Mark as shown and display
            markAsShown(currentServer);
            setState({
                ...state(),
                isVisible: true,
            });
        } else {
            // Otherwise fetch fresh data (showPopup will mark as shown)
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
