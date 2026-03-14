import { useState, useEffect, useCallback, useRef } from 'react';
import { clsx } from 'clsx';
import { useServerConfigStore } from '@/stores/serverConfig';
import { api } from '@/api';
import { Button } from './Button';
import { Input } from './Input';
import { RichTextarea } from './RichTextarea';
import { SERVER_TIMEZONES } from '@/lib/timezones';
import type { ServerPopupConfig, EventConfig } from '@sgchat/shared';

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

  // Icon upload state
  const iconFileRef = useRef<HTMLInputElement>(null);
  const [isUploadingIcon, setIsUploadingIcon] = useState(false);
  const [iconDragOver, setIconDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Banner upload state
  const bannerFileRef = useRef<HTMLInputElement>(null);
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);
  const [bannerDragOver, setBannerDragOver] = useState(false);

  const textChannels = channels.filter((c) => c.type === 'text');

  // Load config on mount
  useEffect(() => {
    fetchConfig(serverId);
  }, [fetchConfig, serverId]);

  // Sync local config with store (initial load + remote updates when no local edits)
  useEffect(() => {
    if (config) {
      if (!localConfig || !hasUnsavedChanges) {
        setLocalConfig({ ...config });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

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

  const handleIconFileSelect = useCallback(async (file: File) => {
    setUploadError(null);

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setUploadError('Invalid file type. Allowed: JPEG, PNG, GIF, WebP');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setUploadError('File too large. Maximum size: 5MB');
      return;
    }

    setIsUploadingIcon(true);
    try {
      const result = await api.upload<{ url: string }>('/upload/image', file);
      setLocalConfig((current) => {
        if (!current) return current;
        return { ...current, serverIconUrl: result.url };
      });
      setHasUnsavedChanges(true);
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload icon');
    } finally {
      setIsUploadingIcon(false);
    }
  }, []);

  const handleIconDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIconDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleIconFileSelect(file);
  }, [handleIconFileSelect]);

  const handleIconInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleIconFileSelect(file);
    e.target.value = '';
  }, [handleIconFileSelect]);

  const handleBannerFileSelect = useCallback(async (file: File) => {
    setUploadError(null);

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setUploadError('Invalid file type. Allowed: JPEG, PNG, GIF, WebP');
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setUploadError('File too large. Maximum size: 8MB');
      return;
    }

    setIsUploadingBanner(true);
    try {
      const result = await api.upload<{ banner_url: string }>('/server/banner', file);
      setLocalConfig((current) => {
        if (!current) return current;
        return { ...current, bannerUrl: result.banner_url };
      });
      setHasUnsavedChanges(true);
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload banner');
    } finally {
      setIsUploadingBanner(false);
    }
  }, []);

  const handleBannerDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setBannerDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleBannerFileSelect(file);
  }, [handleBannerFileSelect]);

  const handleBannerInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleBannerFileSelect(file);
    e.target.value = '';
  }, [handleBannerFileSelect]);

  const handleBannerDelete = useCallback(async () => {
    try {
      await api.delete('/server/banner');
      setLocalConfig((current) => {
        if (!current) return current;
        return { ...current, bannerUrl: null };
      });
      setHasUnsavedChanges(true);
    } catch (err: any) {
      setUploadError(err.message || 'Failed to delete banner');
    }
  }, []);

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
            {/* Server Icon with upload */}
            <div className="flex flex-col items-center">
              <div
                className={clsx(
                  'relative w-24 h-24 rounded-full bg-brand-primary flex items-center justify-center text-white text-3xl font-bold mb-3 cursor-pointer group',
                  iconDragOver && 'ring-4 ring-brand-primary ring-offset-2 ring-offset-bg-primary'
                )}
                onClick={() => iconFileRef.current?.click()}
                onDrop={handleIconDrop}
                onDragOver={(e) => { e.preventDefault(); setIconDragOver(true); }}
                onDragLeave={(e) => { e.preventDefault(); setIconDragOver(false); }}
              >
                {localConfig.serverIconUrl ? (
                  <img
                    src={localConfig.serverIconUrl}
                    alt={localConfig.serverName}
                    className={clsx(
                      'w-full h-full rounded-full object-cover transition-opacity',
                      (isUploadingIcon || iconDragOver) && 'opacity-50'
                    )}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  (localConfig.serverName || 'S').charAt(0).toUpperCase()
                )}

                {/* Hover / upload overlay */}
                <div className={clsx(
                  'absolute inset-0 rounded-full bg-black/50 flex items-center justify-center transition-opacity',
                  (isUploadingIcon || iconDragOver) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                )}>
                  {isUploadingIcon ? (
                    <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </div>

                <input
                  ref={iconFileRef}
                  type="file"
                  name="server-icon-upload"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  onChange={handleIconInputChange}
                />
              </div>
              <p className="text-xs text-text-muted mt-1">Click or drag to upload</p>
              <p className="text-xs text-text-muted">Min. 128x128</p>
              {uploadError && (
                <p className="text-xs text-danger mt-1">{uploadError}</p>
              )}
            </div>

            {/* Basic Info */}
            <div className="flex-1 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-text-muted mb-2" htmlFor="popup-server-name">
                  Server Name
                </label>
                <input
                  type="text"
                  id="popup-server-name"
                  name="popup-server-name"
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
                <p className="text-xs text-text-muted mb-2">Or enter a URL directly</p>
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
                  Server Banner
                </label>
                <div
                  className={clsx(
                    'relative w-full h-32 rounded-lg border-2 border-dashed cursor-pointer overflow-hidden transition-colors',
                    bannerDragOver
                      ? 'border-accent-primary bg-accent-primary/10'
                      : localConfig.bannerUrl
                        ? 'border-transparent'
                        : 'border-border-subtle hover:border-accent-primary/50'
                  )}
                  onClick={() => bannerFileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setBannerDragOver(true); }}
                  onDragLeave={() => setBannerDragOver(false)}
                  onDrop={handleBannerDrop}
                >
                  {localConfig.bannerUrl ? (
                    <img
                      src={localConfig.bannerUrl}
                      alt="Server banner"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-text-muted">
                      <svg className="w-8 h-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-xs">Click or drag to upload banner</span>
                    </div>
                  )}
                  {isUploadingBanner && (
                    <div className="absolute inset-0 bg-bg-primary/70 flex items-center justify-center">
                      <div className="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {localConfig.bannerUrl && !isUploadingBanner && (
                    <div className="absolute inset-0 bg-black/0 hover:bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                      <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                  )}
                </div>
                <input
                  ref={bannerFileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  onChange={handleBannerInputChange}
                />
                {localConfig.bannerUrl && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleBannerDelete(); }}
                    className="mt-2 text-xs text-status-danger hover:underline"
                  >
                    Remove banner
                  </button>
                )}
                <p className="text-xs text-text-muted mt-1">
                  Wide image recommended (1920x480). Max 8MB. Processed to 4:1 aspect ratio.
                </p>
                <p className="text-xs text-text-muted mt-2 mb-1">Or enter a URL directly</p>
                <Input
                  type="url"
                  value={localConfig.bannerUrl || ''}
                  onChange={(e) => handleFieldChange('bannerUrl', e.target.value || null)}
                  placeholder="https://example.com/banner.jpg"
                  className="w-full"
                />
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
                  name="motd-enabled"
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

          {/* Events Section */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase text-text-muted">Events</h3>
              <button
                type="button"
                onClick={() => {
                  const newEvent: EventConfig = {
                    id: crypto.randomUUID(),
                    type: 'announcement',
                    title: '',
                    content: '',
                    startDate: null,
                    endDate: null,
                    enabled: true,
                  };
                  handleFieldChange('events', [...(localConfig.events || []), newEvent]);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-brand-primary hover:bg-brand-primary/10 rounded transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
                Add Event
              </button>
            </div>

            {(!localConfig.events || localConfig.events.length === 0) ? (
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
                <p className="text-text-muted font-medium mb-1">No Events</p>
                <p className="text-sm text-text-muted">
                  Create announcements, polls, and scheduled events for your server
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {localConfig.events.map((event, index) => (
                  <div
                    key={event.id}
                    className="bg-bg-secondary border border-border-subtle rounded-lg p-4"
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span
                          className={clsx(
                            'px-2 py-0.5 text-xs font-medium rounded flex-shrink-0',
                            event.type === 'announcement' && 'bg-brand-primary/20 text-brand-primary',
                            event.type === 'poll' && 'bg-warning/20 text-warning',
                            event.type === 'scheduled' && 'bg-success/20 text-success',
                          )}
                        >
                          {event.type.charAt(0).toUpperCase() + event.type.slice(1)}
                        </span>
                        <span className="text-sm font-medium text-text-primary truncate">
                          {event.title || 'Untitled Event'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            name={`event-enabled-${index}`}
                            checked={event.enabled}
                            onChange={(e) => {
                              const updated = [...localConfig.events];
                              updated[index] = { ...event, enabled: e.target.checked };
                              handleFieldChange('events', updated);
                            }}
                            className="w-3.5 h-3.5 rounded border-border-subtle bg-bg-tertiary"
                          />
                          <span className="text-xs text-text-muted">Enabled</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = localConfig.events.filter((_, i) => i !== index);
                            handleFieldChange('events', updated);
                          }}
                          className="p-1 text-text-muted hover:text-danger transition-colors"
                          title="Delete event"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-bold uppercase text-text-muted mb-1">
                            Title
                          </label>
                          <input
                            type="text"
                            name={`event-title-${index}`}
                            value={event.title}
                            onChange={(e) => {
                              const updated = [...localConfig.events];
                              updated[index] = { ...event, title: e.target.value };
                              handleFieldChange('events', updated);
                            }}
                            placeholder="Event title"
                            maxLength={100}
                            className="w-full px-3 py-1.5 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary focus:outline-none focus:border-brand-primary"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold uppercase text-text-muted mb-1">
                            Type
                          </label>
                          <select
                            value={event.type}
                            onChange={(e) => {
                              const updated = [...localConfig.events];
                              updated[index] = {
                                ...event,
                                type: e.target.value as 'announcement' | 'poll' | 'scheduled',
                              };
                              handleFieldChange('events', updated);
                            }}
                            className="w-full px-3 py-1.5 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary focus:outline-none focus:border-brand-primary"
                          >
                            <option value="announcement">Announcement</option>
                            <option value="poll">Poll</option>
                            <option value="scheduled">Scheduled</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase text-text-muted mb-1">
                          Content
                        </label>
                        <textarea
                          value={event.content}
                          onChange={(e) => {
                            const updated = [...localConfig.events];
                            updated[index] = { ...event, content: e.target.value };
                            handleFieldChange('events', updated);
                          }}
                          placeholder="Event description (supports markdown)"
                          rows={3}
                          maxLength={2000}
                          className="w-full px-3 py-1.5 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary focus:outline-none focus:border-brand-primary resize-none"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-bold uppercase text-text-muted mb-1">
                            Start Date
                          </label>
                          <input
                            type="datetime-local"
                            name={`event-start-date-${index}`}
                            value={event.startDate || ''}
                            onChange={(e) => {
                              const updated = [...localConfig.events];
                              updated[index] = {
                                ...event,
                                startDate: e.target.value || null,
                              };
                              handleFieldChange('events', updated);
                            }}
                            className="w-full px-3 py-1.5 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary focus:outline-none focus:border-brand-primary"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold uppercase text-text-muted mb-1">
                            End Date
                          </label>
                          <input
                            type="datetime-local"
                            name={`event-end-date-${index}`}
                            value={event.endDate || ''}
                            onChange={(e) => {
                              const updated = [...localConfig.events];
                              updated[index] = {
                                ...event,
                                endDate: e.target.value || null,
                              };
                              handleFieldChange('events', updated);
                            }}
                            className="w-full px-3 py-1.5 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary focus:outline-none focus:border-brand-primary"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
