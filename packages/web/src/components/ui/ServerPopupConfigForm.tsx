import { useState, useEffect, useCallback } from 'react';
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

export function ServerPopupConfigForm({
  serverId,
  isOwner,
  onTransferOwnership,
  onSaveSuccess,
}: ServerPopupConfigFormProps) {
  const config = useServerConfigStore((s) => s.config);
  const channels = useServerConfigStore((s) => s.channels);
  const isLoading = useServerConfigStore((s) => s.isLoading);
  const isSaving = useServerConfigStore((s) => s.isSaving);
  const error = useServerConfigStore((s) => s.error);
  const lastSaved = useServerConfigStore((s) => s.lastSaved);
  const fetchConfig = useServerConfigStore((s) => s.fetchConfig);
  const updateConfig = useServerConfigStore((s) => s.updateConfig);

  const [localConfig, setLocalConfig] = useState<ServerPopupConfig | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  const textChannels = channels.filter((c) => c.type === 'text');

  // Load config on mount
  useEffect(() => {
    fetchConfig(serverId);
  }, [fetchConfig, serverId]);

  // Sync local config with store
  useEffect(() => {
    if (config && !localConfig) {
      setLocalConfig({ ...config });
    }
  }, [config, localConfig]);

  // Warn before navigating away with unsaved changes
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  const handleFieldChange = useCallback(
    <K extends keyof ServerPopupConfig>(field: K, value: ServerPopupConfig[K]) => {
      setLocalConfig((current) => {
        if (!current) return current;
        return { ...current, [field]: value };
      });
      setHasUnsavedChanges(true);
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!localConfig) return;

    const updates = {
      serverName: localConfig.serverName,
      serverIconUrl: localConfig.serverIconUrl,
      bannerUrl: localConfig.bannerUrl,
      timeFormat: localConfig.timeFormat,
      motd: localConfig.motd,
      motdEnabled: localConfig.motdEnabled,
      description: localConfig.description,
      timezone: localConfig.timezone,
      welcomeChannelId: localConfig.welcomeChannelId,
      welcomeMessage: localConfig.welcomeMessage,
      events: localConfig.events,
    };

    const success = await updateConfig(serverId, updates);

    if (success) {
      setHasUnsavedChanges(false);
      setShowSuccessToast(true);
      setTimeout(() => setShowSuccessToast(false), 3000);
      onSaveSuccess?.();
    }
  }, [localConfig, updateConfig, serverId, onSaveSuccess]);

  const handleReset = useCallback(() => {
    if (config) {
      setLocalConfig({ ...config });
      setHasUnsavedChanges(false);
    }
  }, [config]);

  return (
    <div>
      <h2 className="text-xl font-bold text-text-primary mb-5">General Settings</h2>

      {/* Success Toast */}
      {showSuccessToast && (
        <div className="fixed top-4 right-4 z-50 bg-success text-white px-6 py-3 rounded-lg shadow-lg">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <span>Settings saved successfully!</span>
          </div>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="mb-4 bg-danger/20 border border-danger text-danger px-4 py-3 rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <span>{error}</span>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-text-muted">Loading...</div>
        </div>
      )}

      {!isLoading && localConfig && (
        <>
          {/* Basic Information */}
          <div className="flex gap-6 mb-8">
            {/* Server Icon */}
            <div className="flex flex-col items-center">
              <div className="w-24 h-24 rounded-full bg-brand-primary flex items-center justify-center text-white text-3xl font-bold mb-3">
                {localConfig.serverIconUrl ? (
                  <img
                    src={localConfig.serverIconUrl}
                    alt={localConfig.serverName}
                    className="w-full h-full rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  (localConfig.serverName || 'S').charAt(0).toUpperCase()
                )}
              </div>
              <p className="text-xs text-text-muted mt-1">Min. 128x128</p>
            </div>

            {/* Basic Info */}
            <div className="flex-1 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-text-muted mb-2">
                  Server Name
                </label>
                <input
                  type="text"
                  value={localConfig.serverName || ''}
                  onChange={(e) => handleFieldChange('serverName', e.target.value)}
                  maxLength={100}
                  className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-text-muted mb-2">
                  Description
                </label>
                <textarea
                  value={localConfig.description || ''}
                  onChange={(e) => handleFieldChange('description', e.target.value || null)}
                  rows={3}
                  maxLength={500}
                  className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary resize-none"
                  placeholder="Tell people about your server..."
                />
                <p className="text-xs text-text-muted mt-1">
                  {(localConfig.description || '').length}/500
                </p>
              </div>
            </div>
          </div>

          {/* Icon & Banner URLs */}
          <div className="mb-8">
            <h3 className="text-sm font-bold uppercase text-text-muted mb-3">Visual Settings</h3>
            <div className="bg-bg-secondary rounded-lg p-4 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-text-muted mb-2">
                  Server Icon URL
                </label>
                <Input
                  type="url"
                  value={localConfig.serverIconUrl || ''}
                  onChange={(e) =>
                    handleFieldChange('serverIconUrl', e.target.value || null)
                  }
                  placeholder="https://example.com/icon.png"
                  className="w-full"
                />
                <p className="text-xs text-text-muted mt-1">Square image recommended (256x256+)</p>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-text-muted mb-2">
                  Banner Image URL
                </label>
                <Input
                  type="url"
                  value={localConfig.bannerUrl || ''}
                  onChange={(e) => handleFieldChange('bannerUrl', e.target.value || null)}
                  placeholder="https://example.com/banner.jpg"
                  className="w-full"
                />
                {localConfig.bannerUrl && (
                  <div className="mt-2 p-3 bg-bg-tertiary rounded border border-border-subtle">
                    <img
                      src={localConfig.bannerUrl}
                      alt="Banner preview"
                      className="w-full h-32 rounded object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).alt = 'Failed to load banner';
                      }}
                    />
                    <span className="text-xs text-text-muted mt-2 block">
                      Preview (16:9 aspect ratio recommended)
                    </span>
                  </div>
                )}
                <p className="text-xs text-text-muted mt-1">Wide image recommended (1920x1080)</p>
              </div>
            </div>
          </div>

          {/* Message of the Day */}
          <div className="mb-8">
            <h3 className="text-sm font-bold uppercase text-text-muted mb-3">Message of the Day</h3>
            <div className="bg-bg-secondary rounded-lg p-4">
              <label className="flex items-center gap-3 mb-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localConfig.motdEnabled ?? true}
                  onChange={(e) => handleFieldChange('motdEnabled', e.target.checked)}
                  className="w-4 h-4 rounded border-border-subtle bg-bg-tertiary"
                />
                <span className="text-sm text-text-primary">Enable MOTD</span>
              </label>
              {localConfig.motdEnabled !== false && (
                <RichTextarea
                  value={localConfig.motd || ''}
                  onInput={(v) => handleFieldChange('motd', v || null)}
                  placeholder="Welcome message shown to members..."
                  maxLength={2000}
                  rows={4}
                  showVariables={true}
                  showFormatting={true}
                />
              )}
            </div>
          </div>

          {/* Welcome Message */}
          <div className="mb-8">
            <h3 className="text-sm font-bold uppercase text-text-muted mb-3">Welcome Message</h3>
            <div className="bg-bg-secondary rounded-lg p-4">
              <RichTextarea
                value={localConfig.welcomeMessage || ''}
                onInput={(v) => handleFieldChange('welcomeMessage', v || null)}
                placeholder="Welcome to our server! Use {username} to insert user's name..."
                maxLength={500}
                rows={4}
                showVariables={true}
                showFormatting={true}
              />
              {localConfig.welcomeMessage?.includes('{username}') && (
                <div className="mt-3 p-2 bg-brand-primary/20 border border-brand-primary rounded text-sm text-brand-primary">
                  <span className="font-medium">Preview: </span>
                  {localConfig.welcomeMessage.replace('{username}', 'DemonFiend')}
                </div>
              )}
            </div>
          </div>

          {/* Server Configuration */}
          <div className="mb-8">
            <h3 className="text-sm font-bold uppercase text-text-muted mb-3">Server Configuration</h3>
            <div className="bg-bg-secondary rounded-lg p-4 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-text-muted mb-2">
                  Welcome Channel
                </label>
                <select
                  value={localConfig.welcomeChannelId || ''}
                  onChange={(e) =>
                    handleFieldChange('welcomeChannelId', e.target.value || null)
                  }
                  className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
                >
                  <option value="">No welcome channel</option>
                  {textChannels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      #{channel.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-text-muted mt-1">
                  Channel where welcome messages and announcements are posted
                </p>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-text-muted mb-2">
                  Server Timezone
                </label>
                <select
                  value={localConfig.timezone || 'UTC'}
                  onChange={(e) => handleFieldChange('timezone', e.target.value)}
                  className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
                >
                  {SERVER_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-text-muted mb-2">
                  Time Format
                </label>
                <select
                  value={localConfig.timeFormat || '24h'}
                  onChange={(e) =>
                    handleFieldChange('timeFormat', e.target.value as '12h' | '24h')
                  }
                  className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
                >
                  <option value="24h">24-hour (14:30:00)</option>
                  <option value="12h">12-hour (2:30:00 PM)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Events Section (Placeholder) */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-bold uppercase text-text-muted">Events</h3>
              <span className="px-2 py-0.5 text-xs font-medium bg-bg-tertiary text-text-muted rounded">
                Coming Soon
              </span>
            </div>
            <div className="p-6 bg-bg-secondary border border-border-subtle rounded-lg text-center">
              <svg
                className="w-12 h-12 mx-auto text-text-muted mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <p className="text-text-muted font-medium mb-1">Future Feature: Events</p>
              <p className="text-sm text-text-muted">
                Create announcements, polls, and scheduled events for your server
              </p>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex items-center gap-4 mb-8">
            <Button onClick={handleSave} disabled={!hasUnsavedChanges || isSaving} variant="primary">
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
            <Button
              onClick={handleReset}
              disabled={!hasUnsavedChanges || isSaving}
              variant="secondary"
            >
              Reset
            </Button>
            {hasUnsavedChanges && (
              <span className="text-sm text-yellow-500">Unsaved changes</span>
            )}
            {lastSaved && (
              <span className="text-xs text-text-muted">
                Last saved: {new Date(lastSaved).toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Danger Zone */}
          {isOwner && (
            <div className="border-t border-danger/30 pt-6">
              <h3 className="text-sm font-bold uppercase text-danger mb-3">Danger Zone</h3>
              <div className="bg-danger/10 border border-danger/30 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-text-primary">Transfer Ownership</h4>
                    <p className="text-sm text-text-muted">Transfer this server to another member</p>
                  </div>
                  <button
                    onClick={() => onTransferOwnership?.()}
                    className="px-4 py-2 bg-danger hover:bg-danger/90 text-white text-sm font-medium rounded transition-colors"
                  >
                    Transfer
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
