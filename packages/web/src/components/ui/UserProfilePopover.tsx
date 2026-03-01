import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from './Avatar';
import { voiceService } from '@/lib/voiceService';
import { useVoiceStore } from '@/stores/voice';
import { api } from '@/api';

interface VoiceChannel {
  id: string;
  name: string;
}

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
  canMuteMembers?: boolean;
  canDeafenMembers?: boolean;
  canKickMembers?: boolean;
  canBanMembers?: boolean;
  canWarnMembers?: boolean;
  isCurrentUser?: boolean;
  serverId?: string;
  voiceChannels?: VoiceChannel[];
  onSendMessage?: (userId: string) => void;
}

type FriendStatus = 'none' | 'friends' | 'pending_outgoing' | 'pending_incoming' | 'loading';

export function UserProfilePopover({
  onClose,
  anchorRect,
  userId,
  username,
  displayName: displayNameProp,
  avatarUrl,
  status,
  roleColor,
  customStatus,
  isInVoice,
  voiceChannelId,
  canMoveMembers,
  canDisconnectMembers,
  canMuteMembers,
  canDeafenMembers,
  canKickMembers,
  canBanMembers,
  canWarnMembers,
  isCurrentUser,
  serverId,
  voiceChannels,
  onSendMessage,
}: UserProfilePopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [volume, setVolume] = useState(() => voiceService.getUserVolume(userId));
  const [locallyMuted, setLocallyMuted] = useState(() => voiceService.isLocallyMuted(userId));
  const [friendStatus, setFriendStatus] = useState<FriendStatus>('loading');
  const [actionLoading, setActionLoading] = useState(false);
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'warn' | 'kick' | 'ban' | null>(null);
  const [modReason, setModReason] = useState('');

  const isConnected = useVoiceStore((s) => s.isConnected());
  const isDeafened = useVoiceStore((s) => s.localState.isDeafened);

  const fetchFriendStatus = useCallback(async () => {
    try {
      const friends = await api.get<any[]>('/friends');
      if (friends?.some((f: any) => f.id === userId)) {
        setFriendStatus('friends');
        return;
      }

      const requests = await api.get<{ incoming: any[]; outgoing: any[] }>('/friends/requests');
      if (
        requests?.outgoing?.some(
          (r: any) => r.to_user_id === userId || r.id === userId
        )
      ) {
        setFriendStatus('pending_outgoing');
        return;
      }
      if (
        requests?.incoming?.some(
          (r: any) => r.from_user_id === userId || r.id === userId
        )
      ) {
        setFriendStatus('pending_incoming');
        return;
      }

      setFriendStatus('none');
    } catch {
      setFriendStatus('none');
    }
  }, [userId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmAction) {
          setConfirmAction(null);
          setModReason('');
        } else if (showMovePicker) {
          setShowMovePicker(false);
        } else {
          onClose();
        }
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const raf = requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClickOutside);
    });

    if (!isCurrentUser) {
      fetchFriendStatus();
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
      cancelAnimationFrame(raf);
    };
  }, [confirmAction, showMovePicker, onClose, isCurrentUser, fetchFriendStatus]);

  const handleSendFriendRequest = async () => {
    setActionLoading(true);
    try {
      await api.post(`/friends/${userId}`, {});
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
      await api.post(`/friends/requests/${userId}/accept`, {});
      setFriendStatus('friends');
    } catch (err: any) {
      console.error('[UserProfilePopover] Failed to accept friend request:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendMessage = useCallback(() => {
    if (onSendMessage) {
      onSendMessage(userId);
    }
    onClose();
  }, [onSendMessage, userId, onClose]);

  const position = useMemo(() => {
    const popoverWidth = 300;
    const popoverHeight = 500;
    const padding = 8;

    let x = anchorRect.left - popoverWidth - padding;
    if (x < padding) {
      x = anchorRect.right + padding;
    }
    if (x + popoverWidth > window.innerWidth - padding) {
      x = window.innerWidth - popoverWidth - padding;
    }

    let y = anchorRect.top + (anchorRect.bottom - anchorRect.top) / 2 - popoverHeight / 2;
    y = Math.max(padding, Math.min(y, window.innerHeight - popoverHeight - padding));

    return { x, y };
  }, [anchorRect]);

  const displayName = displayNameProp || username;

  const handleVolumeChange = useCallback(
    (value: number) => {
      setVolume(value);
      voiceService.setUserVolume(userId, value);
    },
    [userId]
  );

  const handleToggleLocalMute = useCallback(() => {
    voiceService.toggleLocalMute(userId);
    setLocallyMuted(voiceService.isLocallyMuted(userId));
  }, [userId]);

  const handleToggleLocalDeafen = useCallback(() => {
    voiceService.toggleDeafen();
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (voiceChannelId) {
      try {
        await voiceService.disconnectMember(userId, voiceChannelId);
      } catch (err) {
        console.error('[UserProfilePopover] Failed to disconnect member:', err);
      }
    }
    onClose();
  }, [userId, voiceChannelId, onClose]);

  const handleMove = useCallback(
    async (toChannelId: string) => {
      if (voiceChannelId) {
        try {
          await voiceService.moveMember(userId, voiceChannelId, toChannelId);
          setShowMovePicker(false);
        } catch (err) {
          console.error('[UserProfilePopover] Failed to move member:', err);
        }
      }
      onClose();
    },
    [userId, voiceChannelId, onClose]
  );

  const handleServerMute = useCallback(async () => {
    if (voiceChannelId) {
      try {
        const participants = useVoiceStore.getState().getParticipants(voiceChannelId);
        const participant = participants.find((p) => p.userId === userId);
        const isCurrentlyMuted = participant?.isMuted || false;
        await voiceService.serverMuteMember(userId, voiceChannelId, !isCurrentlyMuted);
      } catch (err) {
        console.error('[UserProfilePopover] Failed to server mute:', err);
      }
    }
  }, [userId, voiceChannelId]);

  const handleServerDeafen = useCallback(async () => {
    if (voiceChannelId) {
      try {
        const participants = useVoiceStore.getState().getParticipants(voiceChannelId);
        const participant = participants.find((p) => p.userId === userId);
        const isCurrentlyDeafened = participant?.isDeafened || false;
        await voiceService.serverDeafenMember(userId, voiceChannelId, !isCurrentlyDeafened);
      } catch (err) {
        console.error('[UserProfilePopover] Failed to server deafen:', err);
      }
    }
  }, [userId, voiceChannelId]);

  const handleWarn = useCallback(async () => {
    if (!serverId) return;
    setActionLoading(true);
    try {
      await api.post(`/servers/${serverId}/members/${userId}/warn`, {
        reason: modReason || undefined,
      });
      setConfirmAction(null);
      setModReason('');
      onClose();
    } catch (err: any) {
      console.error('[UserProfilePopover] Failed to warn member:', err);
    } finally {
      setActionLoading(false);
    }
  }, [serverId, userId, modReason, onClose]);

  const handleKick = useCallback(async () => {
    if (!serverId) return;
    setActionLoading(true);
    try {
      await api.post(`/servers/${serverId}/members/${userId}/kick`, {
        reason: modReason || undefined,
      });
      setConfirmAction(null);
      setModReason('');
      onClose();
    } catch (err: any) {
      console.error('[UserProfilePopover] Failed to kick member:', err);
    } finally {
      setActionLoading(false);
    }
  }, [serverId, userId, modReason, onClose]);

  const handleBan = useCallback(async () => {
    if (!serverId) return;
    setActionLoading(true);
    try {
      await api.post(`/servers/${serverId}/members/${userId}/ban`, {
        reason: modReason || undefined,
      });
      setConfirmAction(null);
      setModReason('');
      onClose();
    } catch (err: any) {
      console.error('[UserProfilePopover] Failed to ban member:', err);
    } finally {
      setActionLoading(false);
    }
  }, [serverId, userId, modReason, onClose]);

  const showVoiceControls = isInVoice && !isCurrentUser && isConnected;

  const hasAnyModAction =
    canMoveMembers ||
    canDisconnectMembers ||
    canMuteMembers ||
    canDeafenMembers ||
    canKickMembers ||
    canBanMembers ||
    canWarnMembers;

  const statusLabel = useMemo(() => {
    switch (status) {
      case 'online':
        return 'Online';
      case 'idle':
        return 'Idle';
      case 'dnd':
        return 'Do Not Disturb';
      case 'offline':
        return 'Offline';
      default:
        return 'Offline';
    }
  }, [status]);

  const statusColor = useMemo(() => {
    switch (status) {
      case 'online':
        return 'bg-status-online';
      case 'idle':
        return 'bg-status-idle';
      case 'dnd':
        return 'bg-status-dnd';
      case 'offline':
        return 'bg-status-offline';
      default:
        return 'bg-status-offline';
    }
  }, [status]);

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-[90] w-[300px] bg-bg-primary rounded-lg shadow-high border border-divider overflow-hidden max-h-[85vh] overflow-y-auto"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      {/* Banner / Header */}
      <div
        className="h-16 relative"
        style={{
          background: roleColor
            ? `${roleColor}40`
            : 'var(--color-brand-primary-30, rgba(88, 101, 242, 0.3))',
        }}
      >
        <div className="absolute -bottom-8 left-4">
          <div className="ring-4 ring-bg-primary rounded-full">
            <Avatar
              src={avatarUrl}
              alt={displayName}
              size="lg"
              status={status}
            />
          </div>
        </div>
      </div>

      {/* User Info */}
      <div className="pt-10 px-4 pb-2">
        <div className="flex items-center gap-1.5">
          <h3
            className="text-lg font-semibold truncate"
            style={{ color: roleColor || 'var(--color-text-primary)' }}
          >
            {displayName}
          </h3>
        </div>
        <p className="text-sm text-text-muted">{username}</p>

        <div className="flex items-center gap-1.5 mt-1.5">
          <div className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
          <span className="text-xs text-text-muted">{statusLabel}</span>
        </div>

        {customStatus && (
          <div className="mt-2 text-sm text-text-secondary bg-bg-secondary rounded-md px-2.5 py-1.5">
            {customStatus}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      {!isCurrentUser && (
        <div className="px-4 py-2 flex gap-2">
          {friendStatus === 'friends' && onSendMessage && (
            <button
              onClick={handleSendMessage}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-brand-primary text-white text-sm font-medium rounded-md hover:bg-brand-hover transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              Message
            </button>
          )}

          {friendStatus === 'none' && (
            <button
              onClick={handleSendFriendRequest}
              disabled={actionLoading}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-bg-tertiary text-text-primary text-sm font-medium rounded-md hover:bg-bg-modifier-hover transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                />
              </svg>
              {actionLoading ? 'Sending...' : 'Add Friend'}
            </button>
          )}

          {friendStatus === 'pending_outgoing' && (
            <button
              disabled
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-bg-tertiary text-text-muted text-sm font-medium rounded-md cursor-default"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Request Pending
            </button>
          )}

          {friendStatus === 'pending_incoming' && (
            <button
              onClick={handleAcceptFriendRequest}
              disabled={actionLoading}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-status-online text-white text-sm font-medium rounded-md hover:bg-status-online/80 transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              {actionLoading ? 'Accepting...' : 'Accept Request'}
            </button>
          )}

          {friendStatus === 'friends' && !onSendMessage && (
            <div className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-bg-tertiary text-text-muted text-sm rounded-md">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              Friends
            </div>
          )}

          {friendStatus === 'loading' && (
            <div className="flex-1 flex items-center justify-center px-3 py-1.5">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-primary" />
            </div>
          )}
        </div>
      )}

      <div className="border-t border-divider mx-3" />

      {/* Voice Controls */}
      {showVoiceControls && (
        <>
          <div className="px-4 py-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
              User Volume
            </h4>

            {/* Volume Slider */}
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                />
              </svg>
              <input
                type="range"
                min={0}
                max={200}
                value={volume}
                onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
                className="flex-1 h-1.5 accent-brand-primary cursor-pointer"
              />
              <span className="text-xs text-text-muted w-9 text-right">{volume}%</span>
            </div>

            {/* Local Mute + Local Deafen */}
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleToggleLocalMute}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  locallyMuted
                    ? 'bg-danger/20 text-danger'
                    : 'bg-bg-tertiary text-text-secondary hover:bg-bg-modifier-hover'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                  />
                  {locallyMuted && (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                    />
                  )}
                </svg>
                {locallyMuted ? 'Unmute' : 'Mute'}
              </button>
              <button
                onClick={handleToggleLocalDeafen}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  isDeafened
                    ? 'bg-danger/20 text-danger'
                    : 'bg-bg-tertiary text-text-secondary hover:bg-bg-modifier-hover'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                  />
                </svg>
                {isDeafened ? 'Undeafen' : 'Deafen'}
              </button>
            </div>
          </div>

          <div className="border-t border-divider mx-3" />
        </>
      )}

      {/* Moderation Actions */}
      {!isCurrentUser && hasAnyModAction && (
        <>
          {/* Confirmation Dialog (overlay when active) */}
          {confirmAction ? (
            <div className="px-4 py-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
                {confirmAction === 'warn'
                  ? 'Warn Member'
                  : confirmAction === 'kick'
                    ? 'Kick Member'
                    : 'Ban Member'}
              </h4>
              <p className="text-xs text-text-muted mb-2">
                {confirmAction === 'warn'
                  ? `Send a warning to ${displayName}.`
                  : confirmAction === 'kick'
                    ? `Remove ${displayName} from the server.`
                    : `Permanently ban ${displayName} from the server.`}
              </p>
              <input
                type="text"
                placeholder="Reason (optional)"
                value={modReason}
                onChange={(e) => setModReason(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-bg-secondary border border-border rounded text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary mb-2"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setConfirmAction(null);
                    setModReason('');
                  }}
                  className="flex-1 px-3 py-1.5 text-xs font-medium text-text-secondary bg-bg-tertiary rounded-md hover:bg-bg-modifier-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (confirmAction === 'warn') handleWarn();
                    else if (confirmAction === 'kick') handleKick();
                    else if (confirmAction === 'ban') handleBan();
                  }}
                  disabled={actionLoading}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium text-white rounded-md transition-colors disabled:opacity-50 ${
                    confirmAction === 'warn'
                      ? 'bg-yellow-600 hover:bg-yellow-700'
                      : 'bg-danger hover:bg-danger/80'
                  }`}
                >
                  {actionLoading
                    ? 'Processing...'
                    : confirmAction === 'warn'
                      ? 'Warn'
                      : confirmAction === 'kick'
                        ? 'Kick'
                        : 'Ban'}
                </button>
              </div>
            </div>
          ) : (
            /* Normal mod actions list */
            <div className="px-4 py-3 space-y-0.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
                Moderation
              </h4>

              {/* Voice mod actions */}
              {showVoiceControls && (
                <>
                  {/* Move to Channel */}
                  {canMoveMembers && (
                    <>
                      {showMovePicker ? (
                        <div className="bg-bg-secondary rounded-md p-2 space-y-1 mb-1">
                          <span className="text-xs text-text-muted">Move to:</span>
                          <div className="max-h-32 overflow-y-auto space-y-0.5">
                            {voiceChannels
                              ?.filter((c) => c.id !== voiceChannelId)
                              .map((ch) => (
                                <button
                                  key={ch.id}
                                  onClick={() => handleMove(ch.id)}
                                  className="w-full text-left px-2 py-1 text-sm text-text-secondary rounded hover:bg-bg-modifier-hover transition-colors"
                                >
                                  {ch.name}
                                </button>
                              ))}
                          </div>
                          <button
                            onClick={() => setShowMovePicker(false)}
                            className="text-xs text-text-muted hover:text-text-primary transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowMovePicker(true)}
                          className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-text-secondary rounded hover:bg-bg-modifier-hover transition-colors"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                            />
                          </svg>
                          Move to Channel
                        </button>
                      )}
                    </>
                  )}

                  {/* Server Mute */}
                  {canMuteMembers && (
                    <button
                      onClick={handleServerMute}
                      className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-text-secondary rounded hover:bg-bg-modifier-hover transition-colors"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                        />
                      </svg>
                      Server Mute
                    </button>
                  )}

                  {/* Server Deafen */}
                  {canDeafenMembers && (
                    <button
                      onClick={handleServerDeafen}
                      className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-text-secondary rounded hover:bg-bg-modifier-hover transition-colors"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                        />
                      </svg>
                      Server Deafen
                    </button>
                  )}

                  {/* Disconnect */}
                  {canDisconnectMembers && (
                    <button
                      onClick={handleDisconnect}
                      className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-danger rounded hover:bg-danger/10 transition-colors"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                        />
                      </svg>
                      Disconnect
                    </button>
                  )}
                </>
              )}

              {/* General mod actions (non-voice) */}
              {canWarnMembers && (
                <button
                  onClick={() => setConfirmAction('warn')}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-yellow-500 rounded hover:bg-yellow-500/10 transition-colors"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
                    />
                  </svg>
                  Warn
                </button>
              )}

              {canKickMembers && (
                <button
                  onClick={() => setConfirmAction('kick')}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-danger rounded hover:bg-danger/10 transition-colors"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6"
                    />
                  </svg>
                  Kick
                </button>
              )}

              {canBanMembers && (
                <button
                  onClick={() => setConfirmAction('ban')}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-danger rounded hover:bg-danger/10 transition-colors"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                    />
                  </svg>
                  Ban
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>,
    document.body
  );
}
