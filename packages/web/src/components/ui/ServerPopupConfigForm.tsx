import { createSignal, createEffect, Show, For, onMount } from 'solid-js';
import { useServerConfigStore } from '@/stores/serverConfig';
import { Button } from './Button';
import { Input } from './Input';
import { RichTextarea } from './RichTextarea';
import { SERVER_TIMEZONES } from '@/lib/timezones';
import type { ServerPopupConfig } from '@sgchat/shared';

interface ServerPopupConfigFormProps {
  serverId: string;
  isOwner?: boolean;
  onTransferOwnership?: () => void;
  onSaveSuccess?: () => void;
}

export function ServerPopupConfigForm(props: ServerPopupConfigFormProps) {
  const store = useServerConfigStore;
  const [localConfig, setLocalConfig] = createSignal<ServerPopupConfig | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = createSignal(false);
  const [showSuccessToast, setShowSuccessToast] = createSignal(false);

  const state = () => store.state();
  const config = () => state().config;
  const channels = () => state().channels;
  const isLoading = () => state().isLoading;
  const isSaving = () => state().isSaving;
  const error = () => state().error;

  const textChannels = () => channels().filter((c) => c.type === 'text');

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
    value: ServerPopupConfig[K],
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
      motdEnabled: current.motdEnabled,
      description: current.description,
      timezone: current.timezone,
      welcomeChannelId: current.welcomeChannelId,
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

  return (
    <div>
      <h2 class="text-xl font-bold text-text-primary mb-5">General Settings</h2>

      {/* Success Toast */}
      <Show when={showSuccessToast()}>
        <div class="fixed top-4 right-4 z-50 bg-success text-white px-6 py-3 rounded-lg shadow-lg">
          <div class="flex items-center gap-2">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fill-rule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clip-rule="evenodd"
              />
            </svg>
            <span>Settings saved successfully!</span>
          </div>
        </div>
      </Show>

      {/* Error Alert */}
      <Show when={error()}>
        <div class="mb-4 bg-danger/20 border border-danger text-danger px-4 py-3 rounded-lg">
          <div class="flex items-center gap-2">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fill-rule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clip-rule="evenodd"
              />
            </svg>
            <span>{error()}</span>
          </div>
        </div>
      </Show>

      <Show when={isLoading()}>
        <div class="flex items-center justify-center py-12">
          <div class="text-text-muted">Loading...</div>
        </div>
      </Show>

      <Show when={!isLoading() && localConfig()}>
        {/* Basic Information */}
        <div class="flex gap-6 mb-8">
          {/* Server Icon */}
          <div class="flex flex-col items-center">
            <div class="w-24 h-24 rounded-full bg-brand-primary flex items-center justify-center text-white text-3xl font-bold mb-3">
              <Show
                when={localConfig()?.serverIconUrl}
                fallback={(localConfig()?.serverName || 'S').charAt(0).toUpperCase()}
              >
                <img
                  src={localConfig()!.serverIconUrl!}
                  alt={localConfig()?.serverName}
                  class="w-full h-full rounded-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              </Show>
            </div>
            <p class="text-xs text-text-muted mt-1">Min. 128x128</p>
          </div>

          {/* Basic Info */}
          <div class="flex-1 space-y-4">
            <div>
              <label class="block text-xs font-bold uppercase text-text-muted mb-2">
                Server Name
              </label>
              <input
                type="text"
                value={localConfig()?.serverName || ''}
                onInput={(e) => handleFieldChange('serverName', e.currentTarget.value)}
                maxLength={100}
                class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
              />
            </div>
            <div>
              <label class="block text-xs font-bold uppercase text-text-muted mb-2">
                Description
              </label>
              <textarea
                value={localConfig()?.description || ''}
                onInput={(e) => handleFieldChange('description', e.currentTarget.value || null)}
                rows={3}
                maxLength={500}
                class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary resize-none"
                placeholder="Tell people about your server..."
              />
              <p class="text-xs text-text-muted mt-1">
                {(localConfig()?.description || '').length}/500
              </p>
            </div>
          </div>
        </div>

        {/* Icon & Banner URLs */}
        <div class="mb-8">
          <h3 class="text-sm font-bold uppercase text-text-muted mb-3">Visual Settings</h3>
          <div class="bg-bg-secondary rounded-lg p-4 space-y-4">
            <div>
              <label class="block text-xs font-bold uppercase text-text-muted mb-2">
                Server Icon URL
              </label>
              <Input
                type="url"
                value={localConfig()?.serverIconUrl || ''}
                onInput={(e) =>
                  handleFieldChange('serverIconUrl', e.currentTarget.value || null)
                }
                placeholder="https://example.com/icon.png"
                class="w-full"
              />
              <p class="text-xs text-text-muted mt-1">Square image recommended (256x256+)</p>
            </div>
            <div>
              <label class="block text-xs font-bold uppercase text-text-muted mb-2">
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
                <div class="mt-2 p-3 bg-bg-tertiary rounded border border-border-subtle">
                  <img
                    src={localConfig()!.bannerUrl!}
                    alt="Banner preview"
                    class="w-full h-32 rounded object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).alt = 'Failed to load banner';
                    }}
                  />
                  <span class="text-xs text-text-muted mt-2 block">
                    Preview (16:9 aspect ratio recommended)
                  </span>
                </div>
              </Show>
              <p class="text-xs text-text-muted mt-1">Wide image recommended (1920x1080)</p>
            </div>
          </div>
        </div>

        {/* Message of the Day */}
        <div class="mb-8">
          <h3 class="text-sm font-bold uppercase text-text-muted mb-3">Message of the Day</h3>
          <div class="bg-bg-secondary rounded-lg p-4">
            <label class="flex items-center gap-3 mb-3 cursor-pointer">
              <input
                type="checkbox"
                checked={localConfig()?.motdEnabled ?? true}
                onChange={(e) => handleFieldChange('motdEnabled', e.currentTarget.checked)}
                class="w-4 h-4 rounded border-border-subtle bg-bg-tertiary"
              />
              <span class="text-sm text-text-primary">Enable MOTD</span>
            </label>
            <Show when={localConfig()?.motdEnabled !== false}>
              <RichTextarea
                value={localConfig()?.motd || ''}
                onInput={(v) => handleFieldChange('motd', v || null)}
                placeholder="Welcome message shown to members..."
                maxLength={2000}
                rows={4}
                showVariables={true}
                showFormatting={true}
              />
            </Show>
          </div>
        </div>

        {/* Welcome Message */}
        <div class="mb-8">
          <h3 class="text-sm font-bold uppercase text-text-muted mb-3">Welcome Message</h3>
          <div class="bg-bg-secondary rounded-lg p-4">
            <RichTextarea
              value={localConfig()?.welcomeMessage || ''}
              onInput={(v) => handleFieldChange('welcomeMessage', v || null)}
              placeholder="Welcome to our server! Use {username} to insert user's name..."
              maxLength={500}
              rows={4}
              showVariables={true}
              showFormatting={true}
            />
            <Show when={localConfig()?.welcomeMessage?.includes('{username}')}>
              <div class="mt-3 p-2 bg-brand-primary/20 border border-brand-primary rounded text-sm text-brand-primary">
                <span class="font-medium">Preview: </span>
                {localConfig()!.welcomeMessage!.replace('{username}', 'DemonFiend')}
              </div>
            </Show>
          </div>
        </div>

        {/* Server Configuration */}
        <div class="mb-8">
          <h3 class="text-sm font-bold uppercase text-text-muted mb-3">Server Configuration</h3>
          <div class="bg-bg-secondary rounded-lg p-4 space-y-4">
            <div>
              <label class="block text-xs font-bold uppercase text-text-muted mb-2">
                Welcome Channel
              </label>
              <select
                value={localConfig()?.welcomeChannelId || ''}
                onChange={(e) =>
                  handleFieldChange('welcomeChannelId', e.currentTarget.value || null)
                }
                class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
              >
                <option value="">No welcome channel</option>
                <For each={textChannels()}>
                  {(channel) => <option value={channel.id}>#{channel.name}</option>}
                </For>
              </select>
              <p class="text-xs text-text-muted mt-1">
                Channel where welcome messages and announcements are posted
              </p>
            </div>
            <div>
              <label class="block text-xs font-bold uppercase text-text-muted mb-2">
                Server Timezone
              </label>
              <select
                value={localConfig()?.timezone || 'UTC'}
                onChange={(e) => handleFieldChange('timezone', e.currentTarget.value)}
                class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
              >
                <For each={SERVER_TIMEZONES}>
                  {(tz) => <option value={tz.value}>{tz.label}</option>}
                </For>
              </select>
            </div>
            <div>
              <label class="block text-xs font-bold uppercase text-text-muted mb-2">
                Time Format
              </label>
              <select
                value={localConfig()?.timeFormat || '24h'}
                onChange={(e) =>
                  handleFieldChange('timeFormat', e.currentTarget.value as '12h' | '24h')
                }
                class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
              >
                <option value="24h">24-hour (14:30:00)</option>
                <option value="12h">12-hour (2:30:00 PM)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Events Section (Placeholder) */}
        <div class="mb-8">
          <div class="flex items-center gap-2 mb-3">
            <h3 class="text-sm font-bold uppercase text-text-muted">Events</h3>
            <span class="px-2 py-0.5 text-xs font-medium bg-bg-tertiary text-text-muted rounded">
              Coming Soon
            </span>
          </div>
          <div class="p-6 bg-bg-secondary border border-border-subtle rounded-lg text-center">
            <svg
              class="w-12 h-12 mx-auto text-text-muted mb-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <p class="text-text-muted font-medium mb-1">Future Feature: Events</p>
            <p class="text-sm text-text-muted">
              Create announcements, polls, and scheduled events for your server
            </p>
          </div>
        </div>

        {/* Save Button */}
        <div class="flex items-center gap-4 mb-8">
          <Button onClick={handleSave} disabled={!hasUnsavedChanges() || isSaving()} variant="primary">
            {isSaving() ? 'Saving...' : 'Save Changes'}
          </Button>
          <Button
            onClick={handleReset}
            disabled={!hasUnsavedChanges() || isSaving()}
            variant="secondary"
          >
            Reset
          </Button>
          <Show when={hasUnsavedChanges()}>
            <span class="text-sm text-yellow-500">Unsaved changes</span>
          </Show>
          <Show when={state().lastSaved}>
            <span class="text-xs text-text-muted">
              Last saved: {new Date(state().lastSaved!).toLocaleTimeString()}
            </span>
          </Show>
        </div>

        {/* Danger Zone */}
        <Show when={props.isOwner}>
          <div class="border-t border-danger/30 pt-6">
            <h3 class="text-sm font-bold uppercase text-danger mb-3">Danger Zone</h3>
            <div class="bg-danger/10 border border-danger/30 rounded-lg p-4">
              <div class="flex items-center justify-between">
                <div>
                  <h4 class="font-medium text-text-primary">Transfer Ownership</h4>
                  <p class="text-sm text-text-muted">Transfer this server to another member</p>
                </div>
                <button
                  onClick={() => props.onTransferOwnership?.()}
                  class="px-4 py-2 bg-danger hover:bg-danger/90 text-white text-sm font-medium rounded transition-colors"
                >
                  Transfer
                </button>
              </div>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
}
