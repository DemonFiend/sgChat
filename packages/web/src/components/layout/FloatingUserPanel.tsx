import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from '@/components/ui/Avatar';
import { authStore, useAuthStore } from '@/stores/auth';
import { api } from '@/api';

const STATUS_OPTIONS = [
  { value: 'online' as const, label: 'Online', color: 'bg-status-online' },
  { value: 'idle' as const, label: 'Idle', color: 'bg-status-idle' },
  { value: 'dnd' as const, label: 'Do Not Disturb', color: 'bg-status-dnd' },
  { value: 'offline' as const, label: 'Invisible', color: 'bg-status-offline' },
];

const CLEAR_AFTER_OPTIONS = [
  { value: null, label: "Don't clear" },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 240, label: '4 hours' },
  { value: 'today' as const, label: 'Today' },
  { value: 'week' as const, label: 'This week' },
];

interface FloatingUserPanelProps {
  onSettingsClick: () => void;
  onDMClick: () => void;
  serverTimeOffset?: number;
}

export function FloatingUserPanel({
  onSettingsClick,
  onDMClick,
  serverTimeOffset = 0,
}: FloatingUserPanelProps) {
  const [localTime, setLocalTime] = useState(new Date());
  const [showTimeTooltip, setShowTimeTooltip] = useState<'local' | 'server' | null>(null);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [customStatusText, setCustomStatusText] = useState('');
  const [clearAfter, setClearAfter] = useState<number | 'today' | 'week' | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const user = useAuthStore((s) => s.user);

  // Update time every second
  useEffect(() => {
    const interval = setInterval(() => setLocalTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const serverTime = useMemo(() => {
    return new Date(localTime.getTime() + serverTimeOffset * 60000);
  }, [localTime, serverTimeOffset]);

  const statusColor = useMemo(() => {
    const status = user?.status || 'offline';
    const option = STATUS_OPTIONS.find(o => o.value === status);
    return option?.color || 'bg-status-offline';
  }, [user?.status]);

  const calculateExpirationDate = (value: number | 'today' | 'week' | null): string | null => {
    if (value === null) return null;
    const now = new Date();
    if (value === 'today') {
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);
      return endOfDay.toISOString();
    }
    if (value === 'week') {
      const endOfWeek = new Date(now);
      const daysUntilSunday = 7 - endOfWeek.getDay();
      endOfWeek.setDate(endOfWeek.getDate() + daysUntilSunday);
      endOfWeek.setHours(23, 59, 59, 999);
      return endOfWeek.toISOString();
    }
    const expiresAt = new Date(now.getTime() + value * 60 * 1000);
    return expiresAt.toISOString();
  };

  const handleStatusChange = useCallback(async (newStatus: 'online' | 'idle' | 'dnd' | 'offline') => {
    if (isUpdating) return;
    const oldStatus = user?.status;
    setIsUpdating(true);
    authStore.updateStatus(newStatus);
    try {
      await api.patch('/users/me', { status: newStatus });
      setShowStatusPicker(false);
    } catch (err) {
      console.error('[FloatingUserPanel] Failed to update status:', err);
      if (oldStatus) authStore.updateStatus(oldStatus);
    } finally {
      setIsUpdating(false);
    }
  }, [isUpdating, user?.status]);

  const handleSaveCustomStatus = useCallback(async () => {
    if (isUpdating) return;
    const oldCustomStatus = user?.custom_status;
    const oldExpiresAt = user?.custom_status_expires_at;
    const newCustomStatus = customStatusText.trim() || null;
    const expiresAt = newCustomStatus ? calculateExpirationDate(clearAfter) : null;
    setIsUpdating(true);
    authStore.updateCustomStatus(newCustomStatus, expiresAt);
    try {
      await api.patch('/users/me', {
        custom_status: newCustomStatus,
        custom_status_expires_at: expiresAt,
      });
      setShowStatusPicker(false);
      if (!newCustomStatus) {
        setCustomStatusText('');
        setClearAfter(null);
      }
    } catch (err) {
      console.error('[FloatingUserPanel] Failed to update custom status:', err);
      authStore.updateCustomStatus(oldCustomStatus ?? null, oldExpiresAt ?? null);
    } finally {
      setIsUpdating(false);
    }
  }, [isUpdating, user?.custom_status, user?.custom_status_expires_at, customStatusText, clearAfter]);

  const handleClearCustomStatus = useCallback(async () => {
    setCustomStatusText('');
    setClearAfter(null);
    const oldCustomStatus = user?.custom_status;
    const oldExpiresAt = user?.custom_status_expires_at;
    if (!oldCustomStatus) return;
    setIsUpdating(true);
    authStore.updateCustomStatus(null, null);
    try {
      await api.patch('/users/me', {
        custom_status: null,
        custom_status_expires_at: null,
      });
    } catch (err) {
      console.error('[FloatingUserPanel] Failed to clear custom status:', err);
      authStore.updateCustomStatus(oldCustomStatus, oldExpiresAt ?? null);
    } finally {
      setIsUpdating(false);
    }
  }, [user?.custom_status, user?.custom_status_expires_at]);

  const openStatusPicker = () => {
    setCustomStatusText(user?.custom_status || '');
    setShowStatusPicker(true);
  };

  return (
    <div className="fixed bottom-4 right-4 z-40">
      <div className="bg-bg-secondary rounded-2xl shadow-xl border border-bg-tertiary p-3">
        {/* Action buttons row */}
        <div className="flex justify-end gap-1.5 mb-2">
          <button
            onClick={onDMClick}
            className="w-8 h-8 bg-bg-tertiary hover:bg-brand-primary rounded-lg flex items-center justify-center transition-colors group"
            title="Direct Messages"
          >
            <svg className="w-4 h-4 text-text-muted group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </button>
          <button
            onClick={onSettingsClick}
            className="w-8 h-8 bg-bg-tertiary hover:bg-brand-primary rounded-lg flex items-center justify-center transition-colors group"
            title="Settings"
          >
            <svg className="w-4 h-4 text-text-muted group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

        {/* Main content container */}
        <div className="flex items-center gap-3">
          {/* Time buttons - stacked vertically on left */}
          <div className="flex flex-col gap-1">
            {/* Local Time Button */}
            <div className="relative">
              <button
                onMouseEnter={() => setShowTimeTooltip('local')}
                onMouseLeave={() => setShowTimeTooltip(null)}
                className="w-9 h-9 bg-bg-tertiary hover:bg-brand-primary/20 rounded-lg flex items-center justify-center transition-colors group"
                title="Local Time"
              >
                <svg className="w-4 h-4 text-text-muted group-hover:text-brand-primary transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
              {showTimeTooltip === 'local' && (
                <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 bg-bg-floating text-text-primary text-sm px-3 py-2 rounded-lg shadow-lg whitespace-nowrap border border-bg-tertiary">
                  <div className="text-text-muted text-xs mb-1">Local Time</div>
                  <div className="font-mono font-medium">{formatTime(localTime)}</div>
                </div>
              )}
            </div>

            {/* Server Time Button */}
            <div className="relative">
              <button
                onMouseEnter={() => setShowTimeTooltip('server')}
                onMouseLeave={() => setShowTimeTooltip(null)}
                className="w-9 h-9 bg-bg-tertiary hover:bg-status-online/20 rounded-lg flex items-center justify-center transition-colors group"
                title="Server Time"
              >
                <svg className="w-4 h-4 text-text-muted group-hover:text-status-online transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                </svg>
              </button>
              {showTimeTooltip === 'server' && (
                <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 bg-bg-floating text-text-primary text-sm px-3 py-2 rounded-lg shadow-lg whitespace-nowrap border border-bg-tertiary">
                  <div className="text-text-muted text-xs mb-1">Server Time</div>
                  <div className="font-mono font-medium">{formatTime(serverTime)}</div>
                </div>
              )}
            </div>
          </div>

          {/* User Avatar - Large */}
          <div className="relative">
            <Avatar
              src={user?.avatar_url}
              alt={user?.display_name || user?.username || 'User'}
              size="xl"
              className="ring-2 ring-bg-tertiary"
            />
            <button
              onClick={openStatusPicker}
              className={`absolute bottom-0 right-0 w-5 h-5 ${statusColor} rounded-full border-2 border-bg-secondary cursor-pointer hover:ring-2 hover:ring-white/30 transition-all`}
              title="Change status"
            />
          </div>
        </div>
      </div>

      {/* Status Picker Popup */}
      {showStatusPicker && createPortal(
        <div className="fixed inset-0 z-50" onClick={() => setShowStatusPicker(false)}>
          <div
            className="fixed bottom-24 right-4 w-72 bg-bg-secondary rounded-lg shadow-xl border border-bg-tertiary overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-bg-tertiary">
              <h3 className="font-semibold text-text-primary">Set Status</h3>
            </div>

            {/* Status Options */}
            <div className="p-2">
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleStatusChange(option.value)}
                  disabled={isUpdating}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                    user?.status === option.value
                      ? 'bg-bg-modifier-selected'
                      : 'hover:bg-bg-modifier-hover'
                  } disabled:opacity-50`}
                >
                  <div className={`w-3 h-3 rounded-full ${option.color}`} />
                  <span className="text-sm text-text-primary">{option.label}</span>
                  {user?.status === option.value && (
                    <svg className="w-4 h-4 text-brand-primary ml-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>

            <div className="border-t border-bg-tertiary" />

            {/* Custom Status Section */}
            <div className="p-3">
              <div className="text-xs font-semibold uppercase text-text-muted mb-2">Custom Status</div>

              <div className="flex items-center gap-2 bg-bg-tertiary rounded-md px-3 py-2 mb-3">
                <span className="text-lg">😊</span>
                <input
                  type="text"
                  value={customStatusText}
                  onChange={(e) => setCustomStatusText(e.target.value)}
                  placeholder="What's happening?"
                  maxLength={128}
                  className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted outline-none"
                />
              </div>

              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-text-muted">Clear after:</span>
                <select
                  value={clearAfter === null ? '' : String(clearAfter)}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') setClearAfter(null);
                    else if (val === 'today') setClearAfter('today');
                    else if (val === 'week') setClearAfter('week');
                    else setClearAfter(parseInt(val));
                  }}
                  className="flex-1 bg-bg-tertiary text-sm text-text-primary rounded px-2 py-1 outline-none border border-border-subtle focus:border-brand-primary"
                >
                  {CLEAR_AFTER_OPTIONS.map((option) => (
                    <option key={String(option.value)} value={option.value === null ? '' : String(option.value)}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleClearCustomStatus}
                  disabled={isUpdating || !user?.custom_status}
                  className="flex-1 px-3 py-2 text-sm text-text-secondary bg-bg-tertiary rounded-md hover:bg-bg-modifier-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear Status
                </button>
                <button
                  onClick={handleSaveCustomStatus}
                  disabled={isUpdating}
                  className="flex-1 px-3 py-2 text-sm text-white bg-brand-primary rounded-md hover:bg-brand-primary/80 transition-colors disabled:opacity-50"
                >
                  {isUpdating ? 'Saving...' : 'Save'}
                </button>
              </div>

              {user?.custom_status && (
                <div className="mt-3 p-2 bg-bg-tertiary/50 rounded text-xs text-text-muted">
                  <span className="font-medium">Current:</span> {user.custom_status}
                  {user.custom_status_expires_at && (
                    <div className="mt-1">
                      Clears: {new Date(user.custom_status_expires_at).toLocaleString()}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* User info tooltip */}
      {user && (
        <div className="mt-2 text-center">
          <span className="text-xs text-text-muted bg-bg-secondary/80 px-2 py-1 rounded">
            {user.display_name || user.username}
          </span>
        </div>
      )}
    </div>
  );
}
