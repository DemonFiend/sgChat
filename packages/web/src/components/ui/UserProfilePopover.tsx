import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Avatar } from './Avatar';
import { voiceService } from '@/lib/voiceService';
import { voiceStore } from '@/stores/voice';
import { api } from '@/api';

interface UserProfilePopoverProps {
  onClose: () => void;
  anchorRect: { top: number; left: number; bottom: number; right: number };
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status?: 'online' | 'idle' | 'dnd' | 'offline';
  roleColor?: string | null;
  customStatus?: string | null;
  isInVoice?: boolean;
  voiceChannelId?: string;
  canMoveMembers?: boolean;
  canDisconnectMembers?: boolean;
  isCurrentUser?: boolean;
  onSendMessage?: (userId: string) => void;
}

type FriendStatus = 'none' | 'friends' | 'pending_outgoing' | 'pending_incoming' | 'loading';

export function UserProfilePopover(props: UserProfilePopoverProps) {
  let popoverRef: HTMLDivElement | undefined;
  const [volume, setVolume] = createSignal(voiceService.getUserVolume(props.userId));
  const [locallyMuted, setLocallyMuted] = createSignal(voiceService.isLocallyMuted(props.userId));
  const [friendStatus, setFriendStatus] = createSignal<FriendStatus>('loading');
  const [actionLoading, setActionLoading] = createSignal(false);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose();
  };

  const handleClickOutside = (e: MouseEvent) => {
    if (popoverRef && !popoverRef.contains(e.target as Node)) {
      props.onClose();
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
    requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClickOutside);
    });

    // Fetch friend status for non-current users
    if (!props.isCurrentUser) {
      fetchFriendStatus();
    }
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('mousedown', handleClickOutside);
  });

  const fetchFriendStatus = async () => {
    try {
      // Check friends list
      const friends = await api.get<any[]>('/friends');
      if (friends?.some((f: any) => f.id === props.userId)) {
        setFriendStatus('friends');
        return;
      }

      // Check pending requests
      const requests = await api.get<{ incoming: any[]; outgoing: any[] }>('/friends/requests');
      if (requests?.outgoing?.some((r: any) => r.to_user_id === props.userId || r.id === props.userId)) {
        setFriendStatus('pending_outgoing');
        return;
      }
      if (requests?.incoming?.some((r: any) => r.from_user_id === props.userId || r.id === props.userId)) {
        setFriendStatus('pending_incoming');
        return;
      }

      setFriendStatus('none');
    } catch {
      setFriendStatus('none');
    }
  };

  const handleSendFriendRequest = async () => {
    setActionLoading(true);
    try {
      await api.post(`/friends/${props.userId}`, {});
      setFriendStatus('pending_outgoing');
    } catch (err: any) {
      console.error('[UserProfilePopover] Failed to send friend request:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAcceptFriendRequest = async () => {
    setActionLoading(true);
    try {
      await api.post(`/friends/requests/${props.userId}/accept`, {});
      setFriendStatus('friends');
    } catch (err: any) {
      console.error('[UserProfilePopover] Failed to accept friend request:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendMessage = () => {
    if (props.onSendMessage) {
      props.onSendMessage(props.userId);
    }
    props.onClose();
  };

  // Position the popover relative to the anchor
  const position = () => {
    const popoverWidth = 300;
    const popoverHeight = 420;
    const padding = 8;
    const anchor = props.anchorRect;

    // Try to position to the left of the anchor
    let x = anchor.left - popoverWidth - padding;
    if (x < padding) {
      x = anchor.right + padding;
    }
    if (x + popoverWidth > window.innerWidth - padding) {
      x = window.innerWidth - popoverWidth - padding;
    }

    // Center vertically relative to anchor
    let y = anchor.top + (anchor.bottom - anchor.top) / 2 - popoverHeight / 2;
    y = Math.max(padding, Math.min(y, window.innerHeight - popoverHeight - padding));

    return { x, y };
  };

  const displayName = () => props.displayName || props.username;

  const handleVolumeChange = (value: number) => {
    setVolume(value);
    voiceService.setUserVolume(props.userId, value);
  };

  const handleToggleLocalMute = () => {
    voiceService.toggleLocalMute(props.userId);
    setLocallyMuted(voiceService.isLocallyMuted(props.userId));
  };

  const handleDisconnect = async () => {
    if (props.voiceChannelId) {
      try {
        await voiceService.disconnectMember(props.userId, props.voiceChannelId);
      } catch (err) {
        console.error('[UserProfilePopover] Failed to disconnect member:', err);
      }
    }
    props.onClose();
  };

  const showVoiceControls = () =>
    props.isInVoice && !props.isCurrentUser && voiceStore.isConnected();

  const statusLabel = () => {
    switch (props.status) {
      case 'online': return 'Online';
      case 'idle': return 'Idle';
      case 'dnd': return 'Do Not Disturb';
      case 'offline': return 'Offline';
      default: return 'Offline';
    }
  };

  const statusColor = () => {
    switch (props.status) {
      case 'online': return 'bg-status-online';
      case 'idle': return 'bg-status-idle';
      case 'dnd': return 'bg-status-dnd';
      case 'offline': return 'bg-status-offline';
      default: return 'bg-status-offline';
    }
  };

  return (
    <Portal>
      <div
        ref={popoverRef}
        class="fixed z-[90] w-[300px] bg-bg-primary rounded-lg shadow-high border border-divider overflow-hidden"
        style={{
          left: `${position().x}px`,
          top: `${position().y}px`,
        }}
      >
        {/* Banner / Header */}
        <div
          class="h-16 relative"
          style={{ background: props.roleColor ? `${props.roleColor}40` : 'var(--color-brand-primary-30, rgba(88, 101, 242, 0.3))' }}
        >
          <div class="absolute -bottom-8 left-4">
            <div class="ring-4 ring-bg-primary rounded-full">
              <Avatar
                src={props.avatarUrl}
                alt={displayName()}
                size="lg"
                status={props.status}
              />
            </div>
          </div>
        </div>

        {/* User Info */}
        <div class="pt-10 px-4 pb-2">
          <div class="flex items-center gap-1.5">
            <h3
              class="text-lg font-semibold truncate"
              style={{ color: props.roleColor || 'var(--color-text-primary)' }}
            >
              {displayName()}
            </h3>
          </div>
          <p class="text-sm text-text-muted">{props.username}</p>

          {/* Status indicator with label */}
          <div class="flex items-center gap-1.5 mt-1.5">
            <div class={`w-2.5 h-2.5 rounded-full ${statusColor()}`} />
            <span class="text-xs text-text-muted">{statusLabel()}</span>
          </div>

          <Show when={props.customStatus}>
            <div class="mt-2 text-sm text-text-secondary bg-bg-secondary rounded-md px-2.5 py-1.5">
              {props.customStatus}
            </div>
          </Show>
        </div>

        {/* Action Buttons */}
        <Show when={!props.isCurrentUser}>
          <div class="px-4 py-2 flex gap-2">
            {/* Send Message Button */}
            <Show when={friendStatus() === 'friends' && props.onSendMessage}>
              <button
                onClick={handleSendMessage}
                class="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-brand-primary text-white text-sm font-medium rounded-md hover:bg-brand-hover transition-colors"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Message
              </button>
            </Show>

            {/* Friend Status Button */}
            <Show when={friendStatus() === 'none'}>
              <button
                onClick={handleSendFriendRequest}
                disabled={actionLoading()}
                class="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-bg-tertiary text-text-primary text-sm font-medium rounded-md hover:bg-bg-modifier-hover transition-colors disabled:opacity-50"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
                {actionLoading() ? 'Sending...' : 'Add Friend'}
              </button>
            </Show>

            <Show when={friendStatus() === 'pending_outgoing'}>
              <button
                disabled
                class="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-bg-tertiary text-text-muted text-sm font-medium rounded-md cursor-default"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Request Pending
              </button>
            </Show>

            <Show when={friendStatus() === 'pending_incoming'}>
              <button
                onClick={handleAcceptFriendRequest}
                disabled={actionLoading()}
                class="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-status-online text-white text-sm font-medium rounded-md hover:bg-status-online/80 transition-colors disabled:opacity-50"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                {actionLoading() ? 'Accepting...' : 'Accept Request'}
              </button>
            </Show>

            <Show when={friendStatus() === 'friends' && !props.onSendMessage}>
              <div class="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-bg-tertiary text-text-muted text-sm rounded-md">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                Friends
              </div>
            </Show>

            <Show when={friendStatus() === 'loading'}>
              <div class="flex-1 flex items-center justify-center px-3 py-1.5">
                <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-primary" />
              </div>
            </Show>
          </div>
        </Show>

        <div class="border-t border-divider mx-3" />

        {/* Voice Controls */}
        <Show when={showVoiceControls()}>
          <div class="px-4 py-3">
            <h4 class="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
              User Volume
            </h4>

            {/* Volume Slider */}
            <div class="flex items-center gap-2">
              <button
                onClick={handleToggleLocalMute}
                class={`p-1 rounded transition-colors ${
                  locallyMuted()
                    ? 'text-danger hover:bg-danger/10'
                    : 'text-text-muted hover:bg-bg-modifier-hover'
                }`}
                title={locallyMuted() ? 'Unmute' : 'Mute'}
              >
                <Show
                  when={!locallyMuted() && volume() > 0}
                  fallback={
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  }
                >
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                </Show>
              </button>

              <input
                type="range"
                min={0}
                max={200}
                value={volume()}
                onInput={(e) => handleVolumeChange(parseInt(e.currentTarget.value))}
                class="flex-1 h-1.5 accent-brand-primary cursor-pointer"
              />

              <span class="text-xs text-text-muted w-9 text-right">{volume()}%</span>
            </div>
          </div>

          <div class="border-t border-divider mx-3" />
        </Show>

        {/* Moderator Actions */}
        <Show when={showVoiceControls() && (props.canMoveMembers || props.canDisconnectMembers)}>
          <div class="px-4 py-3 space-y-1">
            <Show when={props.canDisconnectMembers}>
              <button
                onClick={handleDisconnect}
                class="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-danger rounded hover:bg-danger/10 transition-colors"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                Disconnect from Voice
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </Portal>
  );
}
