import { createSignal, createEffect, Show, onMount } from 'solid-js';
import { useServerConfigStore } from '@/stores/serverConfig';
import { Button } from './Button';
import { Input } from './Input';
import type { ServerPopupConfig } from '@sgchat/shared';

interface ServerPopupConfigFormProps {
    serverId: string;
    onSaveSuccess?: () => void;
}

export function ServerPopupConfigForm(props: ServerPopupConfigFormProps) {
    const store = useServerConfigStore;
    const [localConfig, setLocalConfig] = createSignal<ServerPopupConfig | null>(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = createSignal(false);
    const [showSuccessToast, setShowSuccessToast] = createSignal(false);

    const state = () => store.state();
    const config = () => state().config;
    const isLoading = () => state().isLoading;
    const isSaving = () => state().isSaving;
    const error = () => state().error;

    // Load config on mount
    onMount(() => {
        store.fetchConfig(props.serverId);
    });

    // Sync local config with store
    createEffect(() => {
        const storeConfig = config();
        if (storeConfig && !localConfig()) {
            setLocalConfig({ ...storeConfig });
        }
    });

    // Warn before navigating away with unsaved changes
    createEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (hasUnsavedChanges()) {
                e.preventDefault();
                e.returnValue = '';
            }
        };

        if (hasUnsavedChanges()) {
            window.addEventListener('beforeunload', handler);
            return () => window.removeEventListener('beforeunload', handler);
        }
    });

    const handleFieldChange = <K extends keyof ServerPopupConfig>(
        field: K,
        value: ServerPopupConfig[K]
    ) => {
        const current = localConfig();
        if (!current) return;

        setLocalConfig({ ...current, [field]: value });
        setHasUnsavedChanges(true);
    };

    const handleSave = async () => {
        const current = localConfig();
        if (!current) return;

        const updates = {
            serverName: current.serverName,
            serverIconUrl: current.serverIconUrl,
            bannerUrl: current.bannerUrl,
            timeFormat: current.timeFormat,
            motd: current.motd,
            welcomeMessage: current.welcomeMessage,
            events: current.events,
        };

        const success = await store.updateConfig(props.serverId, updates);

        if (success) {
            setHasUnsavedChanges(false);
            setShowSuccessToast(true);
            setTimeout(() => setShowSuccessToast(false), 3000);
            props.onSaveSuccess?.();
        }
    };

    const handleReset = () => {
        const storeConfig = config();
        if (storeConfig) {
            setLocalConfig({ ...storeConfig });
            setHasUnsavedChanges(false);
        }
    };

    const getCharacterCount = (text: string | null) => {
        return text?.length || 0;
    };

    return (
        <div class="max-w-3xl mx-auto p-6">
            {/* Success Toast */}
            <Show when={showSuccessToast()}>
                <div class="fixed top-4 right-4 z-50 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg animate-in slide-in-from-top">
                    <div class="flex items-center gap-2">
                        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                        </svg>
                        <span>Configuration saved successfully!</span>
                    </div>
                </div>
            </Show>

            {/* Error Alert */}
            <Show when={error()}>
                <div class="mb-4 bg-red-600/20 border border-red-600 text-red-300 px-4 py-3 rounded-lg">
                    <div class="flex items-center gap-2">
                        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
                        </svg>
                        <span>{error()}</span>
                    </div>
                </div>
            </Show>

            <Show when={isLoading()}>
                <div class="flex items-center justify-center py-12">
                    <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
                </div>
            </Show>

            <Show when={!isLoading() && localConfig()}>
                <div class="space-y-8">
                    {/* Header */}
                    <div class="border-b border-gray-700 pb-4">
                        <h2 class="text-2xl font-bold text-white">Popup Configuration</h2>
                        <p class="text-gray-400 mt-1">Customize what users see when they join your server</p>
                    </div>

                    {/* Basic Info Section */}
                    <section class="space-y-4">
                        <h3 class="text-lg font-semibold text-white">Basic Information</h3>

                        <div class="space-y-2">
                            <label class="block text-sm font-medium text-gray-300">
                                Server Name *
                            </label>
                            <Input
                                type="text"
                                value={localConfig()?.serverName || ''}
                                onInput={(e) => handleFieldChange('serverName', e.currentTarget.value)}
                                placeholder="Enter server name"
                                maxLength={100}
                                class="w-full"
                            />
                            <p class="text-xs text-gray-500">Displayed in popup header</p>
                        </div>

                        <div class="space-y-2">
                            <label class="block text-sm font-medium text-gray-300">
                                Server Icon URL
                            </label>
                            <Input
                                type="url"
                                value={localConfig()?.serverIconUrl || ''}
                                onInput={(e) => handleFieldChange('serverIconUrl', e.currentTarget.value || null)}
                                placeholder="https://example.com/icon.png"
                                class="w-full"
                            />
                            <Show when={localConfig()?.serverIconUrl}>
                                <div class="flex items-center gap-3 p-3 bg-gray-800 rounded border border-gray-700">
                                    <img
                                        src={localConfig()!.serverIconUrl!}
                                        alt="Server icon preview"
                                        class="w-16 h-16 rounded-lg object-cover"
                                        onError={(e) => {
                                            e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64"%3E%3Crect fill="%23374151" width="64" height="64"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%239CA3AF" font-size="12"%3EError%3C/text%3E%3C/svg%3E';
                                        }}
                                    />
                                    <span class="text-sm text-gray-400">Preview</span>
                                </div>
                            </Show>
                            <p class="text-xs text-gray-500">Square image recommended (256x256+)</p>
                        </div>
                    </section>

                    {/* Visual Section */}
                    <section class="space-y-4">
                        <h3 class="text-lg font-semibold text-white">Visual Settings</h3>

                        <div class="space-y-2">
                            <label class="block text-sm font-medium text-gray-300">
                                Banner Image URL
                            </label>
                            <Input
                                type="url"
                                value={localConfig()?.bannerUrl || ''}
                                onInput={(e) => handleFieldChange('bannerUrl', e.currentTarget.value || null)}
                                placeholder="https://example.com/banner.jpg"
                                class="w-full"
                            />
                            <Show when={localConfig()?.bannerUrl}>
                                <div class="p-3 bg-gray-800 rounded border border-gray-700">
                                    <img
                                        src={localConfig()!.bannerUrl!}
                                        alt="Banner preview"
                                        class="w-full h-32 rounded object-cover"
                                        onError={(e) => {
                                            e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="128"%3E%3Crect fill="%23374151" width="400" height="128"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%239CA3AF" font-size="14"%3EError loading image%3C/text%3E%3C/svg%3E';
                                        }}
                                    />
                                    <span class="text-sm text-gray-400 mt-2 block">Preview (16:9 aspect ratio)</span>
                                </div>
                            </Show>
                            <p class="text-xs text-gray-500">Wide image recommended (1920x1080)</p>
                        </div>

                        <div class="space-y-2">
                            <label class="block text-sm font-medium text-gray-300">
                                Server Time Format *
                            </label>
                            <select
                                value={localConfig()?.timeFormat || '24h'}
                                onChange={(e) => handleFieldChange('timeFormat', e.currentTarget.value as '12h' | '24h')}
                                class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="24h">24-hour (14:30:00)</option>
                                <option value="12h">12-hour (2:30:00 PM)</option>
                            </select>
                        </div>
                    </section>

                    {/* Content Section */}
                    <section class="space-y-4">
                        <h3 class="text-lg font-semibold text-white">Content</h3>

                        <div class="space-y-2">
                            <label class="block text-sm font-medium text-gray-300">
                                Message of the Day
                            </label>
                            <textarea
                                value={localConfig()?.motd || ''}
                                onInput={(e) => handleFieldChange('motd', e.currentTarget.value || null)}
                                placeholder="Enter your server's message of the day..."
                                maxLength={500}
                                rows={4}
                                class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                            />
                            <div class="flex justify-between text-xs">
                                <span class="text-gray-500">Basic markdown supported: **bold**, *italic*, [links]()</span>
                                <span class={`${getCharacterCount(localConfig()?.motd || null) > 450 ? 'text-yellow-500' : 'text-gray-500'}`}>
                                    {getCharacterCount(localConfig()?.motd || null)} / 500
                                </span>
                            </div>
                        </div>

                        <div class="space-y-2">
                            <label class="block text-sm font-medium text-gray-300">
                                Welcome Message
                            </label>
                            <textarea
                                value={localConfig()?.welcomeMessage || ''}
                                onInput={(e) => handleFieldChange('welcomeMessage', e.currentTarget.value || null)}
                                placeholder="Welcome to our server! Use {username} to insert user's name..."
                                maxLength={500}
                                rows={4}
                                class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                            />
                            <div class="flex justify-between text-xs">
                                <span class="text-gray-500">Use {'{username}'} to insert user's name</span>
                                <span class={`${getCharacterCount(localConfig()?.welcomeMessage || null) > 450 ? 'text-yellow-500' : 'text-gray-500'}`}>
                                    {getCharacterCount(localConfig()?.welcomeMessage || null)} / 500
                                </span>
                            </div>
                            <Show when={localConfig()?.welcomeMessage?.includes('{username}')}>
                                <div class="p-2 bg-blue-600/20 border border-blue-600 rounded text-sm text-blue-300">
                                    <span class="font-medium">Example: </span>
                                    {localConfig()!.welcomeMessage!.replace('{username}', 'DemonFiend')}
                                </div>
                            </Show>
                        </div>
                    </section>

                    {/* Events Section (Placeholder) */}
                    <section class="space-y-4">
                        <div class="flex items-center gap-2">
                            <h3 class="text-lg font-semibold text-white">Events</h3>
                            <span class="px-2 py-0.5 text-xs font-medium bg-gray-700 text-gray-300 rounded">Coming Soon</span>
                        </div>
                        <div class="p-6 bg-gray-800/50 border border-gray-700 rounded-lg text-center">
                            <svg class="w-12 h-12 mx-auto text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <p class="text-gray-400 font-medium mb-1">Future Feature: Events</p>
                            <p class="text-sm text-gray-500">
                                Create announcements, polls, and scheduled events for your server
                            </p>
                        </div>
                    </section>

                    {/* Action Buttons */}
                    <div class="sticky bottom-0 bg-gray-900 border-t border-gray-700 pt-4 -mx-6 px-6 -mb-6 pb-6">
                        <div class="flex items-center justify-between">
                            <div class="text-sm text-gray-400">
                                <Show when={hasUnsavedChanges()}>
                                    <span class="text-yellow-500">• Unsaved changes</span>
                                </Show>
                                <Show when={state().lastSaved}>
                                    <span>Last saved: {new Date(state().lastSaved!).toLocaleTimeString()}</span>
                                </Show>
                            </div>
                            <div class="flex gap-3">
                                <Button
                                    onClick={handleReset}
                                    disabled={!hasUnsavedChanges() || isSaving()}
                                    variant="secondary"
                                >
                                    Reset
                                </Button>
                                <Button
                                    onClick={handleSave}
                                    disabled={!hasUnsavedChanges() || isSaving()}
                                    variant="primary"
                                >
                                    <Show when={isSaving()}>
                                        <svg class="animate-spin h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24">
                                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                    </Show>
                                    {isSaving() ? 'Saving...' : 'Save Changes'}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </Show>
        </div>
    );
}
