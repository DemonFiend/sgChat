import { createSignal, Show, onCleanup, For } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Avatar } from '@/components/ui';
import { authStore } from '@/stores/auth';
import { api } from '@/api';

// Status options
const STATUS_OPTIONS = [
  { value: 'online' as const, label: 'Online', color: 'bg-status-online' },
  { value: 'idle' as const, label: 'Idle', color: 'bg-status-idle' },
  { value: 'dnd' as const, label: 'Do Not Disturb', color: 'bg-status-dnd' },
  { value: 'offline' as const, label: 'Invisible', color: 'bg-status-offline' }
];

// Clear after options for custom status
const CLEAR_AFTER_OPTIONS = [
  { value: null, label: "Don't clear" },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 240, label: '4 hours' },
  { value: 'today' as const, label: 'Today' },
  { value: 'week' as const, label: 'This week' }
];

interface FloatingUserPanelProps {
  onSettingsClick: () => void;
  onDMClick: () => void;
  serverTimeOffset?: number; // Offset in minutes from local time
}

export function FloatingUserPanel(props: FloatingUserPanelProps) {
  const [localTime, setLocalTime] = createSignal(new Date());
  const [showTimeTooltip, setShowTimeTooltip] = createSignal<'local' | 'server' | null>(null);
  const [showStatusPicker, setShowStatusPicker] = createSignal(false);
  const [customStatusText, setCustomStatusText] = createSignal('');
  const [clearAfter, setClearAfter] = createSignal<number | 'today' | 'week' | null>(null);
  const [isUpdating, setIsUpdating] = createSignal(false);

  // Update time every minute
  const interval = setInterval(() => {
    setLocalTime(new Date());
  }, 1000);

  onCleanup(() => clearInterval(interval));

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getServerTime = () => {
    const offset = props.serverTimeOffset || 0;
    const serverDate = new Date(localTime().getTime() + offset * 60000);
    return serverDate;
  };

  const user = () => authStore.state().user;

  // Get status color class based on current status
  const getStatusColor = () => {
    const status = user()?.status || 'offline';
    const option = STATUS_OPTIONS.find(o => o.value === status);
    return option?.color || 'bg-status-offline';
  };

  // Calculate expiration date based on clearAfter value
  const calculateExpirationDate = (value: number | 'today' | 'week' | null): string | null => {
    if (value === null) return null;
    
    const now = new Date();
    
    if (value === 'today') {
      // End of today (midnight)
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);
      return endOfDay.toISOString();
    }
    
    if (value === 'week') {
      // End of this week (Sunday midnight)
      const endOfWeek = new Date(now);
      const daysUntilSunday = 7 - endOfWeek.getDay();
      endOfWeek.setDate(endOfWeek.getDate() + daysUntilSunday);
      endOfWeek.setHours(23, 59, 59, 999);
      return endOfWeek.toISOString();
    }
    
    // value is in minutes
    const expiresAt = new Date(now.getTime() + value * 60 * 1000);
    return expiresAt.toISOString();
  };

  // Handle status change
  const handleStatusChange = async (newStatus: 'online' | 'idle' | 'dnd' | 'offline') => {
    if (isUpdating()) return;
    
    const oldStatus = user()?.status;
    setIsUpdating(true);
    
    // Optimistic update
    authStore.updateStatus(newStatus);
    
    try {
      await api.patch('/users/me', { status: newStatus });
      setShowStatusPicker(false);
    } catch (err) {
      console.error('[FloatingUserPanel] Failed to update status:', err);
      // Revert on failure
      if (oldStatus) authStore.updateStatus(oldStatus);
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle custom status save
  const handleSaveCustomStatus = async () => {
    if (isUpdating()) return;
    
    const oldCustomStatus = user()?.custom_status;
    const oldExpiresAt = user()?.custom_status_expires_at;
    
    const newCustomStatus = customStatusText().trim() || null;
    const expiresAt = newCustomStatus ? calculateExpirationDate(clearAfter()) : null;
    
    setIsUpdating(true);
    
    // Optimistic update
    authStore.updateCustomStatus(newCustomStatus, expiresAt);
    
    try {
      await api.patch('/users/me', { 
        custom_status: newCustomStatus,
        custom_status_expires_at: expiresAt
      });
      setShowStatusPicker(false);
      // Clear the input after successful save
      if (!newCustomStatus) {
        setCustomStatusText('');
        setClearAfter(null);
      }
    } catch (err) {
      console.error('[FloatingUserPanel] Failed to update custom status:', err);
      // Revert on failure
      authStore.updateCustomStatus(oldCustomStatus ?? null, oldExpiresAt ?? null);
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle clear custom status
  const handleClearCustomStatus = async () => {
    setCustomStatusText('');
    setClearAfter(null);
    
    const oldCustomStatus = user()?.custom_status;
    const oldExpiresAt = user()?.custom_status_expires_at;
    
    if (!oldCustomStatus) return; // Nothing to clear
    
    setIsUpdating(true);
    authStore.updateCustomStatus(null, null);
    
    try {
      await api.patch('/users/me', { 
        custom_status: null,
        custom_status_expires_at: null
      });
    } catch (err) {
      console.error('[FloatingUserPanel] Failed to clear custom status:', err);
      authStore.updateCustomStatus(oldCustomStatus, oldExpiresAt ?? null);
    } finally {
      setIsUpdating(false);
    }
  };

  // Initialize custom status text from user data
  const openStatusPicker = () => {
    setCustomStatusText(user()?.custom_status || '');
    setShowStatusPicker(true);
  };

  return (
    <div class="fixed bottom-4 right-4 z-40">
      <div class="relative bg-bg-secondary rounded-2xl shadow-xl border border-bg-tertiary p-3">
        {/* Settings Button - Top right, spiky circle */}
        <button
          onClick={props.onSettingsClick}
          class="absolute -top-2 -right-2 w-10 h-10 bg-bg-tertiary hover:bg-brand-primary rounded-full flex items-center justify-center transition-colors group shadow-lg border border-bg-tertiary"
          title="Settings"
        >
          <svg 
            class="w-5 h-5 text-text-muted group-hover:text-white transition-colors" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path 
              stroke-linecap="round" 
              stroke-linejoin="round" 
              stroke-width="2" 
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" 
            />
            <path 
              stroke-linecap="round" 
              stroke-linejoin="round" 
              stroke-width="2" 
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" 
            />
          </svg>
        </button>

        {/* Main content container */}
        <div class="flex items-center gap-3">
          {/* Time buttons - stacked vertically on left */}
          <div class="flex flex-col gap-1">
            {/* Local Time Button */}
            <div class="relative">
              <button
                onMouseEnter={() => setShowTimeTooltip('local')}
                onMouseLeave={() => setShowTimeTooltip(null)}
                class="w-9 h-9 bg-bg-tertiary hover:bg-brand-primary/20 rounded-lg flex items-center justify-center transition-colors group"
                title="Local Time"
              >
                <svg 
                  class="w-4 h-4 text-text-muted group-hover:text-brand-primary transition-colors" 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path 
                    stroke-linecap="round" 
                    stroke-linejoin="round" 
                    stroke-width="2" 
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" 
                  />
                </svg>
              </button>
              <Show when={showTimeTooltip() === 'local'}>
                <div class="absolute right-full mr-2 top-1/2 -translate-y-1/2 bg-bg-floating text-text-primary text-sm px-3 py-2 rounded-lg shadow-lg whitespace-nowrap border border-bg-tertiary">
                  <div class="text-text-muted text-xs mb-1">Local Time</div>
                  <div class="font-mono font-medium">{formatTime(localTime())}</div>
                </div>
              </Show>
            </div>

            {/* Server Time Button */}
            <div class="relative">
              <button
                onMouseEnter={() => setShowTimeTooltip('server')}
                onMouseLeave={() => setShowTimeTooltip(null)}
                class="w-9 h-9 bg-bg-tertiary hover:bg-status-online/20 rounded-lg flex items-center justify-center transition-colors group"
                title="Server Time"
              >
                <svg 
                  class="w-4 h-4 text-text-muted group-hover:text-status-online transition-colors" 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path 
                    stroke-linecap="round" 
                    stroke-linejoin="round" 
                    stroke-width="2" 
                    d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" 
                  />
                </svg>
              </button>
              <Show when={showTimeTooltip() === 'server'}>
                <div class="absolute right-full mr-2 top-1/2 -translate-y-1/2 bg-bg-floating text-text-primary text-sm px-3 py-2 rounded-lg shadow-lg whitespace-nowrap border border-bg-tertiary">
                  <div class="text-text-muted text-xs mb-1">Server Time</div>
                  <div class="font-mono font-medium">{formatTime(getServerTime())}</div>
                </div>
              </Show>
            </div>
          </div>

          {/* User Avatar - Large */}
          <div class="relative">
            <Avatar
              src={user()?.avatar_url}
              alt={user()?.display_name || user()?.username || 'User'}
              size="xl"
              class="ring-2 ring-bg-tertiary"
            />
            {/* Clickable Status Indicator */}
            <button
              onClick={openStatusPicker}
              class={`absolute bottom-0 right-0 w-5 h-5 ${getStatusColor()} rounded-full border-2 border-bg-secondary cursor-pointer hover:ring-2 hover:ring-white/30 transition-all`}
              title="Change status"
            />
          </div>
        </div>

        {/* DM Button - Bottom left, moved 80% of button width further left */}
        <button
          onClick={props.onDMClick}
          class="absolute -bottom-2 -left-12 w-11 h-11 bg-bg-tertiary hover:bg-brand-primary rounded-full flex items-center justify-center transition-colors group shadow-lg border border-bg-tertiary"
          title="Direct Messages"
        >
          <svg 
            class="w-6 h-6 text-text-muted group-hover:text-white transition-colors" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path 
              stroke-linecap="round" 
              stroke-linejoin="round" 
              stroke-width="2" 
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" 
            />
          </svg>
        </button>
      </div>

      {/* Status Picker Popup */}
      <Show when={showStatusPicker()}>
        <Portal>
          <div class="fixed inset-0 z-50" onClick={() => setShowStatusPicker(false)}>
            <div 
              class="fixed bottom-24 right-4 w-72 bg-bg-secondary rounded-lg shadow-xl border border-bg-tertiary overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div class="px-4 py-3 border-b border-bg-tertiary">
                <h3 class="font-semibold text-text-primary">Set Status</h3>
              </div>

              {/* Status Options */}
              <div class="p-2">
                <For each={STATUS_OPTIONS}>
                  {(option) => (
                    <button
                      onClick={() => handleStatusChange(option.value)}
                      disabled={isUpdating()}
                      class={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                        user()?.status === option.value 
                          ? 'bg-bg-modifier-selected' 
                          : 'hover:bg-bg-modifier-hover'
                      } disabled:opacity-50`}
                    >
                      <div class={`w-3 h-3 rounded-full ${option.color}`} />
                      <span class="text-sm text-text-primary">{option.label}</span>
                      <Show when={user()?.status === option.value}>
                        <svg class="w-4 h-4 text-brand-primary ml-auto" fill="currentColor" viewBox="0 0 20 20">
                          <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                        </svg>
                      </Show>
                    </button>
                  )}
                </For>
              </div>

              {/* Divider */}
              <div class="border-t border-bg-tertiary" />

              {/* Custom Status Section */}
              <div class="p-3">
                <div class="text-xs font-semibold uppercase text-text-muted mb-2">Custom Status</div>
                
                {/* Custom Status Input */}
                <div class="flex items-center gap-2 bg-bg-tertiary rounded-md px-3 py-2 mb-3">
                  <span class="text-lg">😊</span>
                  <input
                    type="text"
                    value={customStatusText()}
                    onInput={(e) => setCustomStatusText(e.currentTarget.value)}
                    placeholder="What's happening?"
                    maxLength={128}
                    class="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted outline-none"
                  />
                </div>

                {/* Clear After Dropdown */}
                <div class="flex items-center gap-2 mb-3">
                  <span class="text-xs text-text-muted">Clear after:</span>
                  <select
                    value={clearAfter() === null ? '' : String(clearAfter())}
                    onChange={(e) => {
                      const val = e.currentTarget.value;
                      if (val === '') setClearAfter(null);
                      else if (val === 'today') setClearAfter('today');
                      else if (val === 'week') setClearAfter('week');
                      else setClearAfter(parseInt(val));
                    }}
                    class="flex-1 bg-bg-tertiary text-sm text-text-primary rounded px-2 py-1 outline-none border border-border-subtle focus:border-brand-primary"
                  >
                    <For each={CLEAR_AFTER_OPTIONS}>
                      {(option) => (
                        <option value={option.value === null ? '' : String(option.value)}>
                          {option.label}
                        </option>
                      )}
                    </For>
                  </select>
                </div>

                {/* Action Buttons */}
                <div class="flex gap-2">
                  <button
                    onClick={handleClearCustomStatus}
                    disabled={isUpdating() || !user()?.custom_status}
                    class="flex-1 px-3 py-2 text-sm text-text-secondary bg-bg-tertiary rounded-md hover:bg-bg-modifier-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Clear Status
                  </button>
                  <button
                    onClick={handleSaveCustomStatus}
                    disabled={isUpdating()}
                    class="flex-1 px-3 py-2 text-sm text-white bg-brand-primary rounded-md hover:bg-brand-primary/80 transition-colors disabled:opacity-50"
                  >
                    {isUpdating() ? 'Saving...' : 'Save'}
                  </button>
                </div>

                {/* Current Custom Status Display */}
                <Show when={user()?.custom_status}>
                  <div class="mt-3 p-2 bg-bg-tertiary/50 rounded text-xs text-text-muted">
                    <span class="font-medium">Current:</span> {user()?.custom_status}
                    <Show when={user()?.custom_status_expires_at}>
                      <div class="mt-1">
                        Clears: {new Date(user()!.custom_status_expires_at!).toLocaleString()}
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </Portal>
      </Show>

      {/* User info tooltip on avatar hover (optional enhancement) */}
      <Show when={user()}>
        <div class="mt-2 text-center">
          <span class="text-xs text-text-muted bg-bg-secondary/80 px-2 py-1 rounded">
            {user()?.display_name || user()?.username}
          </span>
        </div>
      </Show>
    </div>
  );
}
