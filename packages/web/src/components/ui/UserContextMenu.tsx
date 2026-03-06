import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { voiceService } from '@/lib/voiceService';
import { api } from '@/api';
import { toastStore } from '@/stores/toastNotifications';
import {
  canKickMembers,
  canBanMembers,
  canTimeoutMembers,
  canMuteMembers,
  canDeafenMembers,
  canMoveMembers,
  canDisconnectMembers,
  hasAdminAccess,
} from '@/stores/permissions';

// ── Types ──────────────────────────────────────────────────────────────

type FriendStatus = 'none' | 'friends' | 'pending_outgoing' | 'pending_incoming' | 'loading';

export interface UserContextMenuProps {
  isOpen: boolean;
  onClose: () => void;
  position: { x: number; y: number };
  targetUser: { id: string; username: string; display_name?: string | null };
  currentUserId: string;
  serverId: string;
  serverOwnerId?: string;
  /** Voice context — set when the target user is in a voice channel */
  voiceContext?: {
    channelId: string;
    isMuted: boolean;
    isDeafened: boolean;
  };
  /** Voice channels available for "Move to" action */
  voiceChannels?: { id: string; name: string }[];
  /** Whether the current user is also in voice */
  currentUserInVoice?: boolean;
  // Callbacks
  onOpenProfile: () => void;
  onSendMessage?: () => void;
  onTimeout?: () => void;
}

// ── Component ──────────────────────────────────────────────────────────

export function UserContextMenu({
  isOpen,
  onClose,
  position,
  targetUser,
  currentUserId,
  serverId,
  serverOwnerId,
  voiceContext,
  voiceChannels,
  currentUserInVoice,
  onOpenProfile,
  onSendMessage,
  onTimeout,
}: UserContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [friendStatus, setFriendStatus] = useState<FriendStatus>('loading');
  const [volume, setVolume] = useState(() => voiceService.getUserVolume(targetUser.id));
  const [isLocallyMuted, setIsLocallyMuted] = useState(() => voiceService.isLocallyMuted(targetUser.id));
  const [showMoveSubmenu, setShowMoveSubmenu] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'kick' | 'ban' | null>(null);
  const [confirmReason, setConfirmReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const moveItemRef = useRef<HTMLButtonElement>(null);

  const isCurrentUser = targetUser.id === currentUserId;
  const displayName = targetUser.display_name || targetUser.username;

  // Permissions
  const showVoiceControls = !!voiceContext && !!currentUserInVoice && !isCurrentUser;
  const showVoiceMod = !!voiceContext && !isCurrentUser;
  const showServerMod = !isCurrentUser;
  const pCanMute = canMuteMembers() || hasAdminAccess(serverOwnerId);
  const pCanDeafen = canDeafenMembers() || hasAdminAccess(serverOwnerId);
  const pCanMove = canMoveMembers() || hasAdminAccess(serverOwnerId);
  const pCanDisconnect = canDisconnectMembers() || hasAdminAccess(serverOwnerId);
  const pCanKick = canKickMembers() || hasAdminAccess(serverOwnerId);
  const pCanBan = canBanMembers() || hasAdminAccess(serverOwnerId);
  const pCanTimeout = canTimeoutMembers() || hasAdminAccess(serverOwnerId);

  const hasVoiceModItems = showVoiceMod && (pCanMute || pCanDeafen || pCanMove || pCanDisconnect);
  const hasServerModItems = showServerMod && (pCanTimeout || pCanKick || pCanBan);

  // ── Fetch friend status on mount ───────────────────────────────────
  useEffect(() => {
    if (!isOpen || isCurrentUser) return;
    let cancelled = false;
    (async () => {
      try {
        const friends = await api.get<any[]>('/friends');
        if (cancelled) return;
        if (friends?.some((f: any) => f.id === targetUser.id)) {
          setFriendStatus('friends');
          return;
        }
        const requests = await api.get<{ incoming: any[]; outgoing: any[] }>('/friends/requests');
        if (cancelled) return;
        if (requests?.outgoing?.some((r: any) => r.to_user_id === targetUser.id || r.id === targetUser.id)) {
          setFriendStatus('pending_outgoing');
        } else if (requests?.incoming?.some((r: any) => r.from_user_id === targetUser.id || r.id === targetUser.id)) {
          setFriendStatus('pending_incoming');
        } else {
          setFriendStatus('none');
        }
      } catch {
        if (!cancelled) setFriendStatus('none');
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, targetUser.id, isCurrentUser]);

  // Reset state when target changes
  useEffect(() => {
    if (isOpen) {
      setVolume(voiceService.getUserVolume(targetUser.id));
      setIsLocallyMuted(voiceService.isLocallyMuted(targetUser.id));
      setShowMoveSubmenu(false);
      setConfirmAction(null);
      setConfirmReason('');
      setActionLoading(false);
    }
  }, [isOpen, targetUser.id]);

  // ── Close handlers ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmAction) {
          setConfirmAction(null);
          setConfirmReason('');
        } else if (showMoveSubmenu) {
          setShowMoveSubmenu(false);
        } else {
          onClose();
        }
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const raf = requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClickOutside);
    });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
      cancelAnimationFrame(raf);
    };
  }, [isOpen, onClose, confirmAction, showMoveSubmenu]);

  // ── Position calculation ───────────────────────────────────────────
  const adjustedPosition = useMemo(() => {
    const menuWidth = 220;
    // Rough estimate: items ~36px each, separators ~9px, volume slider ~50px
    const estimatedHeight = 400;
    const x = Math.min(position.x, window.innerWidth - menuWidth - 8);
    const y = Math.min(position.y, window.innerHeight - estimatedHeight - 8);
    return { x: Math.max(8, x), y: Math.max(8, y) };
  }, [position]);

  // ── Actions ────────────────────────────────────────────────────────
  const handleCopyUsername = useCallback(() => {
    navigator.clipboard.writeText(`@${targetUser.username}`).then(() => {
      toastStore.addToast({ type: 'system', title: 'Copied!', message: `@${targetUser.username} copied to clipboard` });
    }).catch(() => {});
    onClose();
  }, [targetUser.username, onClose]);

  const handleFriendAction = useCallback(async () => {
    if (friendStatus === 'none') {
      try {
        await api.post(`/friends/${targetUser.id}`, {});
        setFriendStatus('pending_outgoing');
      } catch {}
    } else if (friendStatus === 'pending_incoming') {
      try {
        await api.post(`/friends/requests/${targetUser.id}/accept`, {});
        setFriendStatus('friends');
      } catch {}
    }
  }, [friendStatus, targetUser.id]);

  const handleVolumeChange = useCallback((value: number) => {
    setVolume(value);
    voiceService.setUserVolume(targetUser.id, value);
  }, [targetUser.id]);

  const handleLocalMute = useCallback(() => {
    voiceService.toggleLocalMute(targetUser.id);
    setIsLocallyMuted(!isLocallyMuted);
  }, [targetUser.id, isLocallyMuted]);

  const handleServerMute = useCallback(async () => {
    if (!voiceContext) return;
    try {
      await voiceService.serverMuteMember(targetUser.id, voiceContext.channelId, !voiceContext.isMuted);
    } catch {}
    onClose();
  }, [targetUser.id, voiceContext, onClose]);

  const handleServerDeafen = useCallback(async () => {
    if (!voiceContext) return;
    try {
      await voiceService.serverDeafenMember(targetUser.id, voiceContext.channelId, !voiceContext.isDeafened);
    } catch {}
    onClose();
  }, [targetUser.id, voiceContext, onClose]);

  const handleMoveToChannel = useCallback(async (toChannelId: string) => {
    if (!voiceContext) return;
    try {
      await voiceService.moveMember(targetUser.id, voiceContext.channelId, toChannelId);
    } catch {}
    onClose();
  }, [targetUser.id, voiceContext, onClose]);

  const handleDisconnect = useCallback(async () => {
    if (!voiceContext) return;
    try {
      await voiceService.disconnectMember(targetUser.id, voiceContext.channelId);
    } catch {}
    onClose();
  }, [targetUser.id, voiceContext, onClose]);

  const handleModAction = useCallback(async (action: 'kick' | 'ban') => {
    setActionLoading(true);
    try {
      await api.post(`/servers/${serverId}/members/${targetUser.id}/${action}`, {
        ...(confirmReason.trim() && { reason: confirmReason.trim() }),
      });
      onClose();
    } catch {
      setActionLoading(false);
    }
  }, [serverId, targetUser.id, confirmReason, onClose]);

  if (!isOpen) return null;

  // ── Move submenu position ──────────────────────────────────────────
  const moveSubmenuStyle = (() => {
    if (!moveItemRef.current) return { top: 0, left: 220 };
    const rect = moveItemRef.current.getBoundingClientRect();
    const subWidth = 180;
    // Try right side, fallback to left
    const goRight = rect.right + subWidth + 8 < window.innerWidth;
    return {
      top: rect.top,
      left: goRight ? rect.right + 4 : rect.left - subWidth - 4,
    };
  })();

  // ── Render ─────────────────────────────────────────────────────────
  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={menuRef}
        className="fixed z-[100] min-w-[220px] max-w-[240px] py-1.5 bg-bg-tertiary rounded-md shadow-lg border border-divider overflow-y-auto"
        style={{
          left: `${adjustedPosition.x}px`,
          top: `${adjustedPosition.y}px`,
          maxHeight: 'calc(100vh - 16px)',
        }}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.1 }}
      >
        {/* ── Confirmation overlay ─────────────────────────────────── */}
        {confirmAction && (
          <div className="px-3 py-2 space-y-2">
            <p className="text-sm text-text-primary font-medium">
              {confirmAction === 'kick' ? 'Kick' : 'Ban'} {displayName}?
            </p>
            <input
              type="text"
              value={confirmReason}
              onChange={(e) => setConfirmReason(e.target.value)}
              placeholder="Reason (optional)"
              className="w-full px-2 py-1.5 text-sm bg-bg-secondary border border-divider rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand-primary"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleModAction(confirmAction);
              }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setConfirmAction(null); setConfirmReason(''); }}
                className="flex-1 px-2 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors rounded hover:bg-bg-modifier-hover"
              >
                Cancel
              </button>
              <button
                onClick={() => handleModAction(confirmAction)}
                disabled={actionLoading}
                className={clsx(
                  'flex-1 px-2 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-50',
                  'bg-danger text-white hover:bg-danger/80'
                )}
              >
                {actionLoading ? 'Processing...' : confirmAction === 'kick' ? 'Kick' : 'Ban'}
              </button>
            </div>
          </div>
        )}

        {/* ── Normal menu items ────────────────────────────────────── */}
        {!confirmAction && (
          <>
            {/* ─── User Actions ─────────────────────────────────────── */}
            <MenuItem
              label="Profile"
              icon={<ProfileIcon />}
              onClick={() => { onOpenProfile(); onClose(); }}
            />
            {onSendMessage && (
              <MenuItem
                label="Message"
                icon={<MessageIcon />}
                onClick={() => { onSendMessage(); onClose(); }}
              />
            )}
            <MenuItem
              label="Copy Username"
              icon={<CopyIcon />}
              onClick={handleCopyUsername}
            />
            {!isCurrentUser && (
              <FriendMenuItem
                status={friendStatus}
                onAction={handleFriendAction}
              />
            )}

            {/* ─── Local Voice Controls ─────────────────────────────── */}
            {showVoiceControls && (
              <>
                <Separator />
                <div className="px-3 py-1.5">
                  <div className="flex items-center gap-2 text-xs text-text-muted mb-1">
                    <VolumeIcon />
                    <span>User Volume</span>
                    <span className="ml-auto text-text-secondary">{volume}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    value={volume}
                    onChange={(e) => handleVolumeChange(Number(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none bg-bg-modifier-hover cursor-pointer accent-brand-primary"
                  />
                </div>
                <MenuItem
                  label={isLocallyMuted ? 'Unmute (Local)' : 'Mute (Local)'}
                  icon={isLocallyMuted ? <MicOffIcon /> : <MicIcon />}
                  onClick={handleLocalMute}
                  active={isLocallyMuted}
                />
              </>
            )}

            {/* ─── Voice Moderation ─────────────────────────────────── */}
            {hasVoiceModItems && (
              <>
                <Separator />
                {pCanMute && (
                  <MenuItem
                    label={voiceContext!.isMuted ? 'Server Unmute' : 'Server Mute'}
                    icon={voiceContext!.isMuted ? <MicIcon /> : <MicOffIcon />}
                    onClick={handleServerMute}
                    active={voiceContext!.isMuted}
                  />
                )}
                {pCanDeafen && (
                  <MenuItem
                    label={voiceContext!.isDeafened ? 'Server Undeafen' : 'Server Deafen'}
                    icon={voiceContext!.isDeafened ? <HeadphonesIcon /> : <HeadphonesOffIcon />}
                    onClick={handleServerDeafen}
                    active={voiceContext!.isDeafened}
                  />
                )}
                {pCanMove && (
                  <div className="relative">
                    <button
                      ref={moveItemRef}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left text-text-secondary hover:bg-bg-modifier-hover hover:text-text-primary transition-colors"
                      onClick={() => setShowMoveSubmenu(!showMoveSubmenu)}
                      onMouseEnter={() => setShowMoveSubmenu(true)}
                    >
                      <span className="w-4 h-4 flex-shrink-0"><MoveIcon /></span>
                      Move to Channel
                      <svg className="w-3 h-3 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    {/* Move submenu */}
                    {showMoveSubmenu && voiceChannels && voiceChannels.length > 0 && (
                      <div
                        className="fixed z-[101] min-w-[180px] py-1.5 bg-bg-tertiary rounded-md shadow-lg border border-divider"
                        style={{
                          top: `${moveSubmenuStyle.top}px`,
                          left: `${moveSubmenuStyle.left}px`,
                        }}
                        onMouseLeave={() => setShowMoveSubmenu(false)}
                      >
                        {voiceChannels
                          .filter((ch) => ch.id !== voiceContext?.channelId)
                          .map((ch) => (
                            <button
                              key={ch.id}
                              className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left text-text-secondary hover:bg-bg-modifier-hover hover:text-text-primary transition-colors"
                              onClick={() => handleMoveToChannel(ch.id)}
                            >
                              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M12 12h.01" />
                              </svg>
                              <span className="truncate">{ch.name}</span>
                            </button>
                          ))}
                        {voiceChannels.filter((ch) => ch.id !== voiceContext?.channelId).length === 0 && (
                          <div className="px-3 py-1.5 text-xs text-text-muted">No other voice channels</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {pCanDisconnect && (
                  <MenuItem
                    label="Disconnect"
                    icon={<DisconnectIcon />}
                    onClick={handleDisconnect}
                    danger
                  />
                )}
              </>
            )}

            {/* ─── Server Moderation ────────────────────────────────── */}
            {hasServerModItems && (
              <>
                <Separator />
                {pCanTimeout && (
                  <MenuItem
                    label="Timeout"
                    icon={<TimeoutIcon />}
                    onClick={() => { onTimeout?.(); onClose(); }}
                    warning
                  />
                )}
                {pCanKick && (
                  <MenuItem
                    label="Kick"
                    icon={<KickIcon />}
                    onClick={() => setConfirmAction('kick')}
                    danger
                  />
                )}
                {pCanBan && (
                  <MenuItem
                    label="Ban"
                    icon={<BanIcon />}
                    onClick={() => setConfirmAction('ban')}
                    danger
                  />
                )}
              </>
            )}
          </>
        )}
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────

function Separator() {
  return <div className="my-1 mx-2 border-t border-divider" />;
}

function MenuItem({
  label,
  icon,
  onClick,
  danger,
  warning,
  disabled,
  active,
}: {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  warning?: boolean;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      className={clsx(
        'flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors',
        disabled
          ? 'text-text-muted cursor-not-allowed opacity-50'
          : danger
            ? 'text-danger hover:bg-danger/10'
            : warning
              ? 'text-yellow-500 hover:bg-yellow-500/10'
              : active
                ? 'text-brand-primary hover:bg-brand-primary/10'
                : 'text-text-secondary hover:bg-bg-modifier-hover hover:text-text-primary'
      )}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      {icon && <span className="w-4 h-4 flex-shrink-0">{icon}</span>}
      {label}
      {active && (
        <svg className="w-3.5 h-3.5 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}

function FriendMenuItem({ status, onAction }: { status: FriendStatus; onAction: () => void }) {
  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-muted">
        <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-text-muted" />
        </div>
        Loading...
      </div>
    );
  }
  if (status === 'friends') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-muted">
        <span className="w-4 h-4 flex-shrink-0"><FriendCheckIcon /></span>
        Friends
      </div>
    );
  }
  if (status === 'pending_outgoing') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-muted">
        <span className="w-4 h-4 flex-shrink-0"><FriendPendingIcon /></span>
        Request Pending
      </div>
    );
  }
  if (status === 'pending_incoming') {
    return (
      <MenuItem
        label="Accept Friend Request"
        icon={<FriendAddIcon />}
        onClick={onAction}
      />
    );
  }
  // status === 'none'
  return (
    <MenuItem
      label="Add Friend"
      icon={<FriendAddIcon />}
      onClick={onAction}
    />
  );
}

// ── Icons ──────────────────────────────────────────────────────────────
// All icons are 16x16 SVGs matching the existing codebase patterns

function ProfileIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

function FriendAddIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
    </svg>
  );
}

function FriendCheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function FriendPendingIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M11 5L6 9H2v6h4l5 4V5z" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
    </svg>
  );
}

function HeadphonesIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 18v-6a9 9 0 0118 0v6M3 18a3 3 0 003 3h0a3 3 0 003-3v-2a3 3 0 00-3-3h0a3 3 0 00-3 3v2zm18 0a3 3 0 01-3 3h0a3 3 0 01-3-3v-2a3 3 0 013-3h0a3 3 0 013 3v2z" />
    </svg>
  );
}

function HeadphonesOffIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 18v-6a9 9 0 0118 0v6M3 18a3 3 0 003 3h0a3 3 0 003-3v-2a3 3 0 00-3-3h0a3 3 0 00-3 3v2zm18 0a3 3 0 01-3 3h0a3 3 0 01-3-3v-2a3 3 0 013-3h0a3 3 0 013 3v2z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4l16 16" />
    </svg>
  );
}

function MoveIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
    </svg>
  );
}

function DisconnectIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
    </svg>
  );
}

function TimeoutIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function KickIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" />
    </svg>
  );
}

function BanIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
    </svg>
  );
}
