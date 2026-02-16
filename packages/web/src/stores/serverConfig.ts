import { createSignal, createRoot } from 'solid-js';
import { api } from '@/api';
import type { ServerPopupConfig, UpdatePopupConfigInput } from '@sgchat/shared';

interface ServerConfigState {
    config: ServerPopupConfig | null;
    isLoading: boolean;
    isSaving: boolean;
    error: string | null;
    isDirty: boolean;
    lastSaved: Date | null;
}

// LocalStorage helper for draft persistence
const DRAFT_KEY_PREFIX = 'serverPopupConfig_draft_';
const DRAFT_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface DraftData {
    config: ServerPopupConfig;
    timestamp: number;
}

function saveDraft(serverId: string, config: ServerPopupConfig): void {
    try {
        const draft: DraftData = {
            config,
            timestamp: Date.now(),
        };
        localStorage.setItem(`${DRAFT_KEY_PREFIX}${serverId}`, JSON.stringify(draft));
    } catch (e) {
        console.warn('[ServerConfig] Failed to save draft to localStorage', e);
    }
}

function loadDraft(serverId: string): ServerPopupConfig | null {
    try {
        const item = localStorage.getItem(`${DRAFT_KEY_PREFIX}${serverId}`);
        if (!item) return null;

        const draft: DraftData = JSON.parse(item);

        // Check if draft is expired
        if (Date.now() - draft.timestamp > DRAFT_TTL) {
            clearDraft(serverId);
            return null;
        }

        return draft.config;
    } catch {
        return null;
    }
}

function clearDraft(serverId: string): void {
    try {
        localStorage.removeItem(`${DRAFT_KEY_PREFIX}${serverId}`);
    } catch {
        // Fail silently
    }
}

function createServerConfigStore() {
    const [state, setState] = createSignal<ServerConfigState>({
        config: null,
        isLoading: false,
        isSaving: false,
        error: null,
        isDirty: false,
        lastSaved: null,
    });

    /**
     * Fetch popup configuration for the server
     */
    const fetchConfig = async (serverId: string): Promise<void> => {
        setState({
            ...state(),
            isLoading: true,
            error: null,
        });

        try {
            const config = await api.get<ServerPopupConfig>('/server/popup-config');

            // Check for draft
            const draft = loadDraft(serverId);
            if (draft) {
                // Ask user if they want to restore draft
                // For now, we'll just use the fetched config
                // This could be enhanced with a UI prompt
            }

            setState({
                ...state(),
                config,
                isLoading: false,
                isDirty: false,
            });
        } catch (error: any) {
            console.error('[ServerConfig] Failed to fetch config:', error);
            setState({
                ...state(),
                error: error.message || 'Failed to load configuration',
                isLoading: false,
            });
        }
    };

    /**
     * Update popup configuration
     */
    const updateConfig = async (serverId: string, updates: UpdatePopupConfigInput): Promise<boolean> => {
        setState({
            ...state(),
            isSaving: true,
            error: null,
        });

        try {
            const updatedConfig = await api.put<ServerPopupConfig>('/server/popup-config', updates);

            setState({
                ...state(),
                config: updatedConfig,
                isSaving: false,
                isDirty: false,
                lastSaved: new Date(),
            });

            // Clear draft on successful save
            clearDraft(serverId);

            return true;
        } catch (error: any) {
            console.error('[ServerConfig] Failed to update config:', error);
            setState({
                ...state(),
                error: error.message || 'Failed to save configuration',
                isSaving: false,
            });
            return false;
        }
    };

    /**
     * Update local state (for controlled inputs)
     */
    const setConfig = (config: ServerPopupConfig): void => {
        setState({
            ...state(),
            config,
            isDirty: true,
        });

        // Auto-save draft
        if (config.serverId) {
            saveDraft(config.serverId, config);
        }
    };

    /**
     * Update a single field
     */
    const updateField = <K extends keyof ServerPopupConfig>(
        field: K,
        value: ServerPopupConfig[K]
    ): void => {
        const current = state().config;
        if (!current) return;

        const updated = { ...current, [field]: value };
        setConfig(updated);
    };

    /**
     * Reset form to last saved state
     */
    const reset = (): void => {
        setState({
            ...state(),
            isDirty: false,
            error: null,
        });
    };

    /**
     * Clear all state
     */
    const clear = (): void => {
        setState({
            config: null,
            isLoading: false,
            isSaving: false,
            error: null,
            isDirty: false,
            lastSaved: null,
        });
    };

    /**
     * Clear error message
     */
    const clearError = (): void => {
        setState({
            ...state(),
            error: null,
        });
    };

    return {
        state,
        fetchConfig,
        updateConfig,
        setConfig,
        updateField,
        reset,
        clear,
        clearError,
    };
}

// Create singleton instance
export const useServerConfigStore = createRoot(createServerConfigStore);
