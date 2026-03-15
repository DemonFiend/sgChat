import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  MentionProvider,
  type MentionContextValue,
  type MentionMember,
  type MentionChannel,
  type MentionRole,
} from '@/contexts/MentionContext';
import { useAuthStore } from '@/stores/auth';
import { useServerPopupStore } from '@/stores/serverPopup';
import { useServerConfigStore } from '@/stores/serverConfig';
import { useVoiceStore } from '@/stores/voice';
import { emojiManifestStore } from '@/stores/emojiManifest';
import { SYSTEM_USER_ID } from '@sgchat/shared';
import { socketService } from '@/lib/socket';
import { voiceService } from '@/lib/voiceService';
import { api } from '@/api';
import { ServerList } from '@/components/layout/ServerList';
import { ServerSidebar } from '@/components/layout/ServerSidebar';
import {
  ChatPanel,
  type Message,
  type MessageAuthor,
  type ChannelInfo,
  type TypingUser,
} from '@/components/layout/ChatPanel';
import { MemberList } from '@/components/layout/MemberList';
import { TitleBar } from '@/components/ui/TitleBar';
import { ServerSettingsModal } from '@/components/ui/ServerSettingsModal';
import { ChannelSettingsModal } from '@/components/ui/ChannelSettingsModal';
import { UserContextMenu } from '@/components/ui/UserContextMenu';
import { TimeoutModal } from '@/components/ui/TimeoutModal';
import { UserProfilePopover } from '@/components/ui/UserProfilePopover';
import { UserSettingsModal } from '@/components/ui/UserSettingsModal';
import { FloatingUserPanel } from '@/components/layout/FloatingUserPanel';
import { ServerWelcomePopup } from '@/components/ui/ServerWelcomePopup';
import { UnclaimedServerBanner } from '@/components/ui/UnclaimedServerBanner';
import { ClaimAdminModal } from '@/components/ui/ClaimAdminModal';
import { UpgradeModal } from '@/components/ui/UpgradeModal';
import { useSocketStore } from '@/lib/socket';
import { StreamViewer } from '@/components/ui/StreamViewer';
import { useStreamViewerStore } from '@/stores/streamViewer';
import { SoundboardPanel } from '@/components/ui/SoundboardPanel';
import { VoiceConnectedBar } from '@/components/ui/VoiceConnectedBar';
import { CommandPalette, type CommandPaletteChannel, type CommandPaletteMember } from '@/components/ui/CommandPalette';
import { useGlobalShortcuts } from '@/hooks/useElectron';
import { canManageChannels, canManageMessages, hasAnyAdminPermission } from '@/stores/permissions';
import { ServerGearMenu } from '@/components/ui/ServerGearMenu';
import { AdminMenu } from '@/components/ui/AdminMenu';
import { EventsPanel } from '@/components/ui/EventsPanel';
import { StorageDashboardPanel } from '@/components/ui/StorageDashboardPanel';
import { eventsStore } from '@/stores/events';
import { slideInRight, easeTransition } from '@/lib/motion';
import { PinnedMessagesPanel, type PinnedMessage } from '@/components/ui/PinnedMessagesPanel';
import { ThreadPanel, type ThreadInfo } from '@/components/ui/ThreadPanel';
import { SearchModal } from '@/components/ui/SearchModal';
import { RolePickerModal } from '@/components/ui/RolePickerModal';
import { NicknameModal } from '@/components/ui/NicknameModal';
import { blockedUsersStore } from '@/stores/blockedUsers';
import { ignoredUsersStore } from '@/stores/ignoredUsers';
import { chatInputStore } from '@/stores/chatInput';
import type { Channel, Category } from '@/components/layout/ChannelList';

interface ServerData {
  id: string;
  name: string;
  icon_url: string | null;
  banner_url: string | null;
  owner_id: string;
  motd?: string;
  server_time?: string;
  timezone?: string;
  admin_claimed?: boolean;
}

interface MemberRole {
  id: string;
  name: string;
  color: string | null;
  position: number;
  is_hoisted: boolean;
}

interface MemberData {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  status: 'online' | 'idle' | 'dnd' | 'offline';
  role_color?: string | null;
  custom_status?: string | null;
  roles?: MemberRole[];
}

export function MainLayout() {
  const { channelId } = useParams<{ channelId?: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const activeStream = useStreamViewerStore((s) => s.activeStream);
  const streamVideoElement = useStreamViewerStore((s) => s.videoElement);
  const voiceConnected = useVoiceStore((s) => s.connectionState === 'connected');

  // Core state
  const [servers, setServers] = useState<ServerData[]>([]);
  const [currentServer, setCurrentServer] = useState<ServerData | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentChannel, setCurrentChannel] = useState<ChannelInfo | null>(null);
  const [members, setMembers] = useState<MemberData[]>([]);
  const [allRoles, setAllRoles] = useState<{ id: string; name: string; color: string | null; position: number }[]>([]);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [isMemberListOpen, setIsMemberListOpen] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Pinned messages state
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const [pinnedMessageIds, setPinnedMessageIds] = useState<Set<string>>(new Set());
  const [isPinnedPanelOpen, setIsPinnedPanelOpen] = useState(false);

  // Thread state
  const [activeThread, setActiveThread] = useState<ThreadInfo | null>(null);
  const [threadMessageIds, setThreadMessageIds] = useState<Set<string>>(new Set());

  // Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Modal & popover state
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [settingsChannel, setSettingsChannel] = useState<{
    id: string;
    name: string;
    type: string;
    topic?: string;
    server_id: string;
    bitrate?: number;
    user_limit?: number;
    voice_relay_policy?: string;
    preferred_relay_id?: string | null;
  } | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [profilePopover, setProfilePopover] = useState<{
    member: MemberData | MessageAuthor;
    rect: DOMRect;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    targetUser: { id: string; username: string; display_name?: string | null };
    position: { x: number; y: number };
  } | null>(null);
  const [timeoutTarget, setTimeoutTarget] = useState<{
    id: string;
    username: string;
    display_name?: string | null;
  } | null>(null);
  const [nicknameModal, setNicknameModal] = useState<{
    targetUser: { id: string; username: string; display_name?: string | null };
    isSelf: boolean;
    currentNickname: string | null;
    currentAdminNickname: string | null;
  } | null>(null);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [userTimezone, setUserTimezone] = useState<string | undefined>(undefined);
  const [showClaimAdmin, setShowClaimAdmin] = useState(false);

  // Gear menu + Events panel + Admin menu state
  const [gearMenuPosition, setGearMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [adminMenuPosition, setAdminMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [showEventsPanel, setShowEventsPanel] = useState(false);
  const [showStorageDashboard, setShowStorageDashboard] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined);

  // Fetch user timezone from settings on mount
  useEffect(() => {
    api.get<{ timezone?: string }>('/users/me/settings').then((settings) => {
      if (settings?.timezone) setUserTimezone(settings.timezone);
    }).catch(() => {});
  }, []);

  // Ref to track loaded channels for auto-redirect logic
  const channelsRef = useRef<Channel[]>([]);
  channelsRef.current = channels;

  // ── Fetch server, channels, members on mount via REST ──────────
  useEffect(() => {
    const fetchServerData = async () => {
      try {
        const server = await api.get<ServerData>('/server');
        setCurrentServer(server);
        setServers([server]);
        // Show server welcome popup (24h cooldown managed by the store)
        useServerPopupStore.getState().showPopup(server.id);
        emojiManifestStore.getState().fetchManifest(server.id);

        // Fetch user permissions for this server
        api.get<{ permissions: Record<string, boolean> }>(`/servers/${server.id}/permissions`).then((data) => {
          if (data?.permissions) {
            useAuthStore.getState().updateUser({ permissions: data.permissions as any });
          }
        }).catch(() => {});

        // Fetch channels
        const channelsResponse = await api.get<
          Channel[] | { channels: Channel[]; categories?: Category[] }
        >('/channels');
        let fetchedChannels: Channel[] = [];
        let fetchedCategories: Category[] = [];
        if (Array.isArray(channelsResponse)) {
          fetchedChannels = channelsResponse;
        } else if (channelsResponse && typeof channelsResponse === 'object') {
          fetchedChannels =
            (channelsResponse as { channels: Channel[] }).channels || [];
          fetchedCategories =
            (channelsResponse as { categories?: Category[] }).categories || [];
        }
        setChannels(fetchedChannels);
        setCategories(fetchedCategories);

        // Fetch members and roles in parallel
        const [membersResponse, rolesResponse] = await Promise.all([
          api.get<MemberData[] | { members: MemberData[] }>('/members'),
          api.get<{ id: string; name: string; color: string | null; position: number }[]>('/roles'),
        ]);
        if (Array.isArray(membersResponse)) {
          setMembers(membersResponse);
        } else if (
          membersResponse &&
          'members' in (membersResponse as { members: MemberData[] })
        ) {
          setMembers(
            (membersResponse as { members: MemberData[] }).members || [],
          );
        }
        if (Array.isArray(rolesResponse)) {
          setAllRoles(rolesResponse);
        }

        // Initialize blocked/ignored user stores
        blockedUsersStore.fetchBlocked();
        ignoredUsersStore.fetchIgnored();

        // Auto-navigate to first text channel if channelId is missing or invalid
        // (e.g. server ID from ServerList click instead of a channel ID)
        const matchedChannel = channelId
          ? fetchedChannels.find((c) => c.id === channelId)
          : null;
        if (!matchedChannel) {
          const firstText = fetchedChannels
            .filter((c) => c.type === 'text')
            .sort((a, b) => a.position - b.position)[0];
          if (firstText) {
            navigate(`/channels/${firstText.id}`, { replace: true });
          }
        }
      } catch (err) {
        console.error('[MainLayout] Failed to fetch server data:', err);
        setLoadError(err instanceof Error ? err.message : 'Failed to load server data');
      }
    };
    fetchServerData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch messages when channelId changes via REST ─────────────
  // Use channelsLoaded flag instead of channels array to avoid re-fetch loop
  // (ackTimer updates channels, which would re-trigger this effect)
  const channelsLoaded = channels.length > 0;

  useEffect(() => {
    if (!channelId) return;

    // Use ref for latest channels data (avoids channels in dependency array)
    const currentChannels = channelsRef.current;

    // Find the channel in our loaded list
    const channel = currentChannels.find((c) => c.id === channelId);
    if (channel) {
      setCurrentChannel({
        id: channel.id,
        name: channel.name,
        topic: channel.topic,
        type: channel.type,
      });
    } else if (currentChannels.length > 0) {
      // channelId doesn't match any channel (e.g. server ID from ServerList click)
      // → auto-redirect to first text channel
      const firstText = currentChannels
        .filter((c) => c.type === 'text')
        .sort((a, b) => a.position - b.position)[0];
      if (firstText) {
        navigate(`/channels/${firstText.id}`, { replace: true });
      }
      return;
    } else {
      // Channels not loaded yet — skip message fetch, will retry when channels arrive
      return;
    }

    // Fetch messages via REST
    const fetchMessages = async () => {
      try {
        const response = await api.get<{ messages: Message[] } | Message[]>(
          `/channels/${channelId}/messages`,
        );
        if (Array.isArray(response)) {
          setMessages(response);
        } else if (response && 'messages' in response) {
          setMessages(response.messages || []);
        }
      } catch (err) {
        console.error('[MainLayout] Failed to fetch messages:', err);
        setMessages([]);
      }
    };
    fetchMessages();

    // Mark channel as read after a brief delay
    const ackTimer = setTimeout(() => {
      api.post(`/channels/${channelId}/ack`).catch(() => {});
      setChannels((prev) =>
        prev.map((c) =>
          c.id === channelId
            ? { ...c, unread_count: 0, has_mentions: false }
            : c,
        ),
      );
    }, 2000);

    // Clear typing users on channel switch
    setTypingUsers([]);

    return () => clearTimeout(ackTimer);
  }, [channelId, channelsLoaded, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch pinned messages when channel changes ───────────────
  useEffect(() => {
    if (!channelId) {
      setPinnedMessages([]);
      setPinnedMessageIds(new Set());
      return;
    }
    api.get<PinnedMessage[]>(`/channels/${channelId}/pinned`)
      .then((pins) => {
        setPinnedMessages(pins);
        setPinnedMessageIds(new Set(pins.map((p) => p.id)));
      })
      .catch(() => {
        setPinnedMessages([]);
        setPinnedMessageIds(new Set());
      });
  }, [channelId]);

  // Pin/unpin handlers
  const handlePinMessage = useCallback(async (messageId: string) => {
    if (!channelId) return;
    try {
      await api.post(`/channels/${channelId}/messages/${messageId}/pin`);
    } catch { /* socket event will update state */ }
  }, [channelId]);

  const handleUnpinMessage = useCallback(async (messageId: string) => {
    if (!channelId) return;
    try {
      await api.delete(`/channels/${channelId}/messages/${messageId}/pin`);
    } catch { /* socket event will update state */ }
  }, [channelId]);

  // Thread handlers
  const handleCreateThread = useCallback(async (message: Message) => {
    if (!channelId) return;
    try {
      const threadName = message.content.slice(0, 50) || 'New Thread';
      const thread = await api.post<ThreadInfo>('/api/threads', {
        name: threadName,
        channel_id: channelId,
        parent_message_id: message.id,
      });
      setActiveThread(thread);
      setThreadMessageIds((prev) => new Set([...prev, message.id]));
    } catch (err) {
      console.error('Failed to create thread:', err);
    }
  }, [channelId]);

  const handleOpenThread = useCallback(async (messageId: string) => {
    try {
      if (!channelId) return;
      const res = await api.get<{ threads: ThreadInfo[] }>(`/channels/${channelId}/threads`);
      const thread = res.threads.find((t: ThreadInfo) => t.parent_message_id === messageId);
      if (thread) {
        setActiveThread(thread);
      }
    } catch (err) {
      console.error('Failed to open thread:', err);
    }
  }, [channelId]);

  // Load thread message IDs when channel changes
  useEffect(() => {
    if (!channelId) return;
    setActiveThread(null);
    const loadThreads = async () => {
      try {
        const res = await api.get<{ threads: ThreadInfo[] }>(`/channels/${channelId}/threads`);
        const ids = new Set<string>();
        for (const t of res.threads) {
          if (t.parent_message_id) ids.add(t.parent_message_id);
        }
        setThreadMessageIds(ids);
      } catch {
        setThreadMessageIds(new Set());
      }
    };
    loadThreads();
  }, [channelId]);

  // ── Wire up real-time message events (correct event names) ─────
  useEffect(() => {
    const handleNewMessage = (message: Message & { channel_id?: string }) => {
      // If message is for a different channel, increment its unread count
      if (message.channel_id && message.channel_id !== channelId) {
        setChannels((prev) =>
          prev.map((c) =>
            c.id === message.channel_id
              ? { ...c, unread_count: (c.unread_count || 0) + 1 }
              : c,
          ),
        );
        return;
      }
      setMessages((prev) => [...prev, message]);
      setTypingUsers((prev) =>
        prev.filter((u) => u.id !== message.author.id),
      );

      // TTS: speak message aloud if is_tts flag is set
      if ((message as any).is_tts && 'speechSynthesis' in window) {
        const displayName = message.author?.display_name || message.author?.username || 'Someone';
        const utterance = new SpeechSynthesisUtterance(`${displayName} says: ${message.content}`);
        utterance.rate = 1;
        utterance.pitch = 1;
        speechSynthesis.speak(utterance);
      }
    };

    const handleMessageUpdate = (data: any) => {
      // Reaction update: has message_id + reactions array
      if (data.message_id && data.reactions) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.message_id ? { ...m, reactions: data.reactions } : m,
          ),
        );
        return;
      }
      // Message edit: has id + content
      if (data.id && data.content !== undefined) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === data.id
              ? { ...m, content: data.content, edited_at: data.edited_at }
              : m,
          ),
        );
      }
    };

    const handleMessageDelete = (data: { id: string }) => {
      setMessages((prev) => prev.filter((m) => m.id !== data.id));
    };

    const handleMessagePin = (data: {
      channel_id: string;
      message: any;
      pinned_by: string;
    }) => {
      if (data.channel_id !== channelId) return;
      const msg = data.message;
      setPinnedMessages((prev) => {
        if (prev.some((p) => p.id === msg.id)) return prev;
        return [{
          id: msg.id,
          content: msg.content,
          author: msg.author || { id: '', username: 'Unknown', display_name: null, avatar_url: null },
          created_at: msg.created_at,
          edited_at: msg.edited_at || null,
          attachments: msg.attachments || [],
          pinned_at: new Date().toISOString(),
          pinned_by: { id: data.pinned_by, username: '' },
        }, ...prev];
      });
      setPinnedMessageIds((prev) => new Set([...prev, msg.id]));
    };

    const handleMessageUnpin = (data: {
      channel_id: string;
      message_id: string;
    }) => {
      if (data.channel_id !== channelId) return;
      setPinnedMessages((prev) => prev.filter((p) => p.id !== data.message_id));
      setPinnedMessageIds((prev) => {
        const next = new Set(prev);
        next.delete(data.message_id);
        return next;
      });
    };

    // Listen for correct backend event names (dot separator for received events)
    socketService.on(
      'message.new',
      handleNewMessage as (data: unknown) => void,
    );
    socketService.on(
      'message.update',
      handleMessageUpdate as (data: unknown) => void,
    );
    socketService.on(
      'message.delete',
      handleMessageDelete as (data: unknown) => void,
    );
    socketService.on(
      'message.pin',
      handleMessagePin as (data: unknown) => void,
    );
    socketService.on(
      'message.unpin',
      handleMessageUnpin as (data: unknown) => void,
    );

    return () => {
      socketService.off(
        'message.new',
        handleNewMessage as (data: unknown) => void,
      );
      socketService.off(
        'message.update',
        handleMessageUpdate as (data: unknown) => void,
      );
      socketService.off(
        'message.delete',
        handleMessageDelete as (data: unknown) => void,
      );
      socketService.off(
        'message.pin',
        handleMessagePin as (data: unknown) => void,
      );
      socketService.off(
        'message.unpin',
        handleMessageUnpin as (data: unknown) => void,
      );
    };
  }, [channelId]);

  // ── Wire up typing events ──────────────────────────────────────
  useEffect(() => {
    const handleTypingStart = (data: any) => {
      // Backend sends { user: { id, username } } but handle both shapes defensively
      const userId = data.user?.id || data.user_id;
      const username = data.user?.username || data.username;
      if (!userId || userId === user?.id) return;
      setTypingUsers((prev) => {
        if (prev.some((u) => u.id === userId)) return prev;
        return [...prev, { id: userId, username: username || 'Someone' }];
      });
      setTimeout(() => {
        setTypingUsers((prev) => prev.filter((u) => u.id !== userId));
      }, 5000);
    };

    const handleTypingStop = (data: any) => {
      const userId = data.user?.id || data.user_id;
      if (!userId) return;
      setTypingUsers((prev) => prev.filter((u) => u.id !== userId));
    };

    socketService.on(
      'typing.start',
      handleTypingStart as (data: unknown) => void,
    );
    socketService.on(
      'typing.stop',
      handleTypingStop as (data: unknown) => void,
    );

    return () => {
      socketService.off(
        'typing.start',
        handleTypingStart as (data: unknown) => void,
      );
      socketService.off(
        'typing.stop',
        handleTypingStop as (data: unknown) => void,
      );
    };
  }, [user?.id]);

  // ── Wire up member events ──────────────────────────────────────
  useEffect(() => {
    const handleMemberUpdate = (data: MemberData) => {
      setMembers((prev) =>
        prev.map((m) => (m.id === data.id ? { ...m, ...data } : m)),
      );

      // Update role_color on existing messages from this user
      if (data.roles) {
        const topColor =
          [...data.roles]
            .filter((r) => r.color)
            .sort((a, b) => b.position - a.position)[0]?.color || null;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.author?.id === data.id
              ? { ...msg, author: { ...msg.author, role_color: topColor } }
              : msg,
          ),
        );
      }
    };

    const handleMemberJoin = (data: MemberData) => {
      setMembers((prev) => [...prev.filter((m) => m.id !== data.id), data]);
    };

    const handleMemberLeave = (data: { user_id: string }) => {
      setMembers((prev) => prev.filter((m) => m.id !== data.user_id));
    };

    socketService.on(
      'member.update',
      handleMemberUpdate as (data: unknown) => void,
    );
    socketService.on(
      'member.join',
      handleMemberJoin as (data: unknown) => void,
    );
    socketService.on(
      'member.leave',
      handleMemberLeave as (data: unknown) => void,
    );

    return () => {
      socketService.off(
        'member.update',
        handleMemberUpdate as (data: unknown) => void,
      );
      socketService.off(
        'member.join',
        handleMemberJoin as (data: unknown) => void,
      );
      socketService.off(
        'member.leave',
        handleMemberLeave as (data: unknown) => void,
      );
    };
  }, []);

  // ── Wire up voice force-move events (for temp channels) ──────────
  useEffect(() => {
    const handleForceMove = (data: any) => {
      const toChannelId = data.to_channel_id;
      const toChannelName = data.to_channel_name || 'Voice Channel';
      if (toChannelId) {
        voiceService.handleForceMove(toChannelId, toChannelName);
      }
    };

    socketService.on(
      'voice.force_move',
      handleForceMove as (data: unknown) => void,
    );

    return () => {
      socketService.off(
        'voice.force_move',
        handleForceMove as (data: unknown) => void,
      );
    };
  }, []);

  // ── Wire up voice join/leave events for real-time participant updates ──
  useEffect(() => {
    const voiceState = useVoiceStore.getState();

    const handleVoiceJoin = (data: any) => {
      const channelId = data.channel_id;
      const userData = data.user;
      if (!channelId || !userData) return;
      voiceState.addParticipant(channelId, {
        id: userData.id,
        username: userData.username,
        display_name: userData.display_name,
        avatar_url: userData.avatar_url,
      });
    };

    const handleVoiceLeave = (data: any) => {
      const channelId = data.channel_id;
      const userId = data.user_id;
      if (!channelId || !userId) return;
      voiceState.removeParticipant(channelId, userId);
    };

    socketService.on(
      'voice.join',
      handleVoiceJoin as (data: unknown) => void,
    );
    socketService.on(
      'voice.leave',
      handleVoiceLeave as (data: unknown) => void,
    );

    const handleVoiceStateUpdate = (data: any) => {
      // Update participant mute/deafen/stream state
      if (data.channel_id && data.user_id) {
        voiceState.updateParticipantState?.(data.channel_id, data.user_id, {
          isMuted: data.is_muted,
          isDeafened: data.is_deafened,
          isStreaming: data.is_streaming,
          isServerMuted: data.is_server_muted,
          isServerDeafened: data.is_server_deafened,
          voiceStatus: data.voice_status,
        });
      }
    };

    const handleForceDisconnect = () => {
      voiceService.leave();
    };

    const handleServerMute = (data: any) => {
      voiceService.setServerMuted(data.muted);
    };

    const handleServerDeafen = (data: any) => {
      voiceService.setServerDeafened(data.deafened);
    };

    const handleRelaySwitch = (data: any) => {
      if (data.channel_id) {
        voiceService.handleRelaySwitch(
          data.channel_id,
          data.new_relay_id || null,
          data.new_relay_region || null,
        );
      }
    };

    socketService.on('voice.state_update', handleVoiceStateUpdate as (data: unknown) => void);
    socketService.on('voice.force_disconnect', handleForceDisconnect as (data: unknown) => void);
    socketService.on('voice.server_mute', handleServerMute as (data: unknown) => void);
    socketService.on('voice.server_deafen', handleServerDeafen as (data: unknown) => void);
    socketService.on('voice.relay_switch', handleRelaySwitch as (data: unknown) => void);

    return () => {
      socketService.off('voice.join', handleVoiceJoin as (data: unknown) => void);
      socketService.off('voice.leave', handleVoiceLeave as (data: unknown) => void);
      socketService.off('voice.state_update', handleVoiceStateUpdate as (data: unknown) => void);
      socketService.off('voice.force_disconnect', handleForceDisconnect as (data: unknown) => void);
      socketService.off('voice.server_mute', handleServerMute as (data: unknown) => void);
      socketService.off('voice.server_deafen', handleServerDeafen as (data: unknown) => void);
      socketService.off('voice.relay_switch', handleRelaySwitch as (data: unknown) => void);
    };
  }, []);

  // ── Wire up server, presence, and channel update events ──────────
  useEffect(() => {
    const handleServerUpdate = (data: any) => {
      if (data.id) {
        setCurrentServer((prev) => prev ? { ...prev, ...data } : prev);
      }
    };

    const handlePresenceUpdate = (data: any) => {
      const userId = data.user_id || data.id;
      if (!userId) return;
      setMembers((prev) =>
        prev.map((m) =>
          m.id === userId
            ? {
                ...m,
                status: data.status ?? m.status,
                avatar_url: data.avatar_url ?? m.avatar_url,
                display_name: data.display_name ?? m.display_name,
                custom_status: data.custom_status ?? m.custom_status,
              }
            : m,
        ),
      );
      // If it's the current user, update auth store too
      if (userId === user?.id && data.avatar_url !== undefined) {
        useAuthStore.getState().updateAvatarUrl(data.avatar_url);
      }
    };

    const handleChannelCreate = (data: any) => {
      // Backend wraps channel in { channel: { ... } } for all create events
      const channel = data.channel || data;
      setChannels((prev) => {
        if (prev.some((c) => c.id === channel.id)) return prev;
        return [...prev, channel];
      });
    };

    const handleChannelUpdate = (data: any) => {
      const channel = data.channel || data;
      setChannels((prev) =>
        prev.map((c) => (c.id === channel.id ? { ...c, ...channel } : c)),
      );
      // Refetch messages if this is the currently viewed channel
      if (channel.id === channelId) {
        api.get<{ messages: Message[] } | Message[]>(
          `/channels/${channel.id}/messages`,
        ).then((response) => {
          if (Array.isArray(response)) {
            setMessages(response);
          } else {
            setMessages(response.messages);
          }
        }).catch((err) => {
          console.error('[MainLayout] Failed to refetch messages after channel update:', err);
        });
      }
    };

    const handleChannelDelete = (data: any) => {
      const deletedId = data.channel?.id || data.id;
      setChannels((prev) => prev.filter((c) => c.id !== deletedId));
    };

    const handlePopupConfigUpdate = (data: any) => {
      if (data && data.serverId) {
        useServerConfigStore.getState().applyRemoteUpdate(data);
      }
      // Also update currentServer state for fields visible in the main UI
      setCurrentServer((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          ...(data.serverName !== undefined && { name: data.serverName }),
          ...(data.serverIconUrl !== undefined && { icon_url: data.serverIconUrl }),
          ...(data.description !== undefined && { description: data.description }),
        };
      });
    };

    socketService.on('server.update', handleServerUpdate as (data: unknown) => void);
    socketService.on('server.popup_config.update', handlePopupConfigUpdate as (data: unknown) => void);
    socketService.on('presence.update', handlePresenceUpdate as (data: unknown) => void);
    const handleChannelsReorder = (data: any) => {
      if (Array.isArray(data)) setChannels(data);
    };

    const handleChannelPermissionsChange = () => {
      // Refetch channels to get updated permission overrides
      api.get<Channel[] | { channels: Channel[]; categories?: Category[] }>('/channels').then((res) => {
        if (Array.isArray(res)) setChannels(res);
        else if (res?.channels) setChannels(res.channels);
      }).catch(() => {});
    };

    const handleCategoryCreate = (data: any) => {
      const cat = data.category || data;
      setCategories((prev) => {
        if (prev.some((c) => c.id === cat.id)) return prev;
        return [...prev, cat];
      });
    };

    const handleCategoryUpdate = (data: any) => {
      const cat = data.category || data;
      setCategories((prev) => prev.map((c) => (c.id === cat.id ? { ...c, ...cat } : c)));
    };

    const handleCategoryDelete = (data: any) => {
      const deletedId = data.id || data.category_id;
      setCategories((prev) => prev.filter((c) => c.id !== deletedId));
    };

    const handleRoleChange = () => {
      // Refetch members to get updated role assignments
      api.get<MemberData[] | { members: MemberData[] }>('/members').then((res) => {
        if (Array.isArray(res)) setMembers(res);
        else if (res?.members) setMembers(res.members);
      }).catch(() => {});
      // Refetch all roles for mention context
      api.get<{ id: string; name: string; color: string | null; position: number }[]>('/roles').then((res) => {
        if (Array.isArray(res)) setAllRoles(res);
      }).catch(() => {});
      // Refetch permissions (role changes may affect current user)
      if (currentServer) {
        api.get<{ permissions: Record<string, boolean> }>(`/servers/${currentServer.id}/permissions`).then((data) => {
          if (data?.permissions) {
            useAuthStore.getState().updateUser({ permissions: data.permissions as any });
          }
        }).catch(() => {});
      }
    };

    const handleMemberRoleChange = (data: any) => {
      // Refresh the specific member's roles
      if (data.user_id) {
        setMembers((prev) => prev.map((m) => {
          if (m.id !== data.user_id) return m;
          if (data.roles) return { ...m, roles: data.roles };
          return m;
        }));
      }
      // Also refetch for full consistency
      handleRoleChange();
    };

    const handleServerDelete = () => {
      window.location.href = '/';
    };

    const handleServerKicked = (data: any) => {
      alert(data.reason ? `You were kicked: ${data.reason}` : 'You were kicked from this server.');
      window.location.href = '/';
    };

    const handleServerBanned = (data: any) => {
      alert(data.reason ? `You were banned: ${data.reason}` : 'You were banned from this server.');
      window.location.href = '/';
    };

    socketService.on('channel.create', handleChannelCreate as (data: unknown) => void);
    socketService.on('channel.update', handleChannelUpdate as (data: unknown) => void);
    socketService.on('channel.delete', handleChannelDelete as (data: unknown) => void);
    socketService.on('channels.reorder', handleChannelsReorder as (data: unknown) => void);
    socketService.on('channel.permissions.update', handleChannelPermissionsChange as (data: unknown) => void);
    socketService.on('channel.permissions.delete', handleChannelPermissionsChange as (data: unknown) => void);
    socketService.on('category.create', handleCategoryCreate as (data: unknown) => void);
    socketService.on('category.update', handleCategoryUpdate as (data: unknown) => void);
    socketService.on('category.delete', handleCategoryDelete as (data: unknown) => void);
    socketService.on('category.permissions.update', handleChannelPermissionsChange as (data: unknown) => void);
    socketService.on('category.permissions.delete', handleChannelPermissionsChange as (data: unknown) => void);
    socketService.on('role.create', handleRoleChange as (data: unknown) => void);
    socketService.on('role.update', handleRoleChange as (data: unknown) => void);
    socketService.on('role.delete', handleRoleChange as (data: unknown) => void);
    socketService.on('roles.reorder', handleRoleChange as (data: unknown) => void);
    socketService.on('member.role.add', handleMemberRoleChange as (data: unknown) => void);
    socketService.on('member.role.remove', handleMemberRoleChange as (data: unknown) => void);
    socketService.on('member.roles.update', handleMemberRoleChange as (data: unknown) => void);
    socketService.on('server.delete', handleServerDelete as (data: unknown) => void);
    socketService.on('server.kicked', handleServerKicked as (data: unknown) => void);
    socketService.on('server.banned', handleServerBanned as (data: unknown) => void);

    // Emoji manifest refresh
    const handleEmojiManifestUpdated = (data: any) => {
      const sid = data?.serverId;
      if (sid) {
        emojiManifestStore.getState().fetchManifest(sid);
      }
    };
    socketService.on('emoji.manifestUpdated', handleEmojiManifestUpdated as (data: unknown) => void);

    const handleEventsInvalidate = () => {
      eventsStore.invalidate();
    };
    socketService.on('serverEvents.invalidate', handleEventsInvalidate as (data: unknown) => void);

    const handleUserBlock = (data: any) => {
      blockedUsersStore.addBlockedUserId(data.blocker_id);
    };
    socketService.on('user.block', handleUserBlock as (data: unknown) => void);

    return () => {
      socketService.off('server.update', handleServerUpdate as (data: unknown) => void);
      socketService.off('server.popup_config.update', handlePopupConfigUpdate as (data: unknown) => void);
      socketService.off('presence.update', handlePresenceUpdate as (data: unknown) => void);
      socketService.off('channel.create', handleChannelCreate as (data: unknown) => void);
      socketService.off('channel.update', handleChannelUpdate as (data: unknown) => void);
      socketService.off('channel.delete', handleChannelDelete as (data: unknown) => void);
      socketService.off('channels.reorder', handleChannelsReorder as (data: unknown) => void);
      socketService.off('channel.permissions.update', handleChannelPermissionsChange as (data: unknown) => void);
      socketService.off('channel.permissions.delete', handleChannelPermissionsChange as (data: unknown) => void);
      socketService.off('category.create', handleCategoryCreate as (data: unknown) => void);
      socketService.off('category.update', handleCategoryUpdate as (data: unknown) => void);
      socketService.off('category.delete', handleCategoryDelete as (data: unknown) => void);
      socketService.off('category.permissions.update', handleChannelPermissionsChange as (data: unknown) => void);
      socketService.off('category.permissions.delete', handleChannelPermissionsChange as (data: unknown) => void);
      socketService.off('role.create', handleRoleChange as (data: unknown) => void);
      socketService.off('role.update', handleRoleChange as (data: unknown) => void);
      socketService.off('role.delete', handleRoleChange as (data: unknown) => void);
      socketService.off('roles.reorder', handleRoleChange as (data: unknown) => void);
      socketService.off('member.role.add', handleMemberRoleChange as (data: unknown) => void);
      socketService.off('member.role.remove', handleMemberRoleChange as (data: unknown) => void);
      socketService.off('member.roles.update', handleMemberRoleChange as (data: unknown) => void);
      socketService.off('server.delete', handleServerDelete as (data: unknown) => void);
      socketService.off('server.kicked', handleServerKicked as (data: unknown) => void);
      socketService.off('server.banned', handleServerBanned as (data: unknown) => void);
      socketService.off('emoji.manifestUpdated', handleEmojiManifestUpdated as (data: unknown) => void);
      socketService.off('serverEvents.invalidate', handleEventsInvalidate as (data: unknown) => void);
      socketService.off('user.block', handleUserBlock as (data: unknown) => void);
    };
  }, [user?.id]);

  // ── Action handlers (correct socket event names) ───────────────
  const handleSendMessage = useCallback(
    (content: string) => {
      if (!currentChannel) return;

      // Check for /tts command prefix
      const isTts = content.startsWith('/tts ');
      const messageContent = isTts ? content.slice(5) : content;

      // Backend expects 'message:send' (colon separator)
      const emitPayload = {
        channel_id: currentChannel.id,
        content: messageContent,
        ...(replyingTo?.id ? { reply_to_id: replyingTo.id } : {}),
        ...(isTts ? { is_tts: true } : {}),
      };
      socketService.emit('message:send', emitPayload);
      setReplyingTo(null);
    },
    [currentChannel, replyingTo],
  );

  const handleTypingStart = useCallback(() => {
    if (!currentChannel) return;
    socketService.emit('typing.start', { channel_id: currentChannel.id });
  }, [currentChannel]);

  const handleTypingStop = useCallback(() => {
    if (!currentChannel) return;
    socketService.emit('typing.stop', { channel_id: currentChannel.id });
  }, [currentChannel]);

  // Reactions use REST API, not socket events
  const handleReactionClick = useCallback(
    (messageId: string, reaction: any) => {
      const isCustom = reaction.type === 'custom' || !!reaction.emojiId;
      if (reaction.me) {
        // Remove reaction
        if (isCustom) {
          api.delete(`/messages/${messageId}/reactions`, { reaction: { type: 'custom', emojiId: reaction.emojiId } })
            .catch((err) => console.error('[MainLayout] Failed to remove reaction:', err));
        } else {
          api.delete(`/messages/${messageId}/reactions/${encodeURIComponent(reaction.emoji)}`)
            .catch((err) => console.error('[MainLayout] Failed to remove reaction:', err));
        }
      } else {
        // Add reaction
        if (isCustom) {
          api.post(`/messages/${messageId}/reactions`, { reaction: { type: 'custom', emojiId: reaction.emojiId } })
            .catch((err) => console.error('[MainLayout] Failed to add reaction:', err));
        } else {
          api.put(`/messages/${messageId}/reactions/${encodeURIComponent(reaction.emoji)}`)
            .catch((err) => console.error('[MainLayout] Failed to add reaction:', err));
        }
      }
    },
    [],
  );

  // Add reaction — supports both unicode emoji strings and custom emoji IDs
  const handleReactionAdd = useCallback(
    (messageId: string, emoji: string, customEmojiId?: string) => {
      if (customEmojiId) {
        // Use typed reaction endpoint for custom emojis
        api
          .post(`/messages/${messageId}/reactions`, { reaction: { type: 'custom', emojiId: customEmojiId } })
          .catch((err) =>
            console.error('[MainLayout] Failed to add reaction:', err),
          );
      } else {
        api
          .put(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`)
          .catch((err) =>
            console.error('[MainLayout] Failed to add reaction:', err),
          );
      }
    },
    [],
  );

  const handleEditMessage = useCallback(
    (messageId: string, newContent: string) => {
      // Backend expects 'message:edit' (colon separator)
      socketService.emit('message:edit', {
        message_id: messageId,
        content: newContent,
      });
    },
    [],
  );

  const handleDeleteMessage = useCallback((messageId: string) => {
    // Backend expects 'message:delete' (colon separator)
    socketService.emit('message:delete', { message_id: messageId });
  }, []);

  const handleAuthorClick = useCallback(
    (author: MessageAuthor, rect: DOMRect) => {
      setProfilePopover({ member: author, rect });
    },
    [],
  );

  const handleMemberClick = useCallback(
    (member: MemberData, rect: DOMRect) => {
      setProfilePopover({ member, rect });
    },
    [],
  );

  const handleMemberContextMenu = useCallback(
    (member: MemberData, e: React.MouseEvent) => {
      e.preventDefault();
      setContextMenu({
        targetUser: { id: member.id, username: member.username, display_name: member.display_name },
        position: { x: e.clientX, y: e.clientY },
      });
    },
    [],
  );

  const handleAuthorContextMenu = useCallback(
    (author: MessageAuthor, e: React.MouseEvent) => {
      e.preventDefault();
      setContextMenu({
        targetUser: { id: author.id, username: author.username, display_name: author.display_name },
        position: { x: e.clientX, y: e.clientY },
      });
    },
    [],
  );

  const handleToggleMemberList = useCallback(() => {
    setIsMemberListOpen((prev) => !prev);
  }, []);

  // Group members for MemberList — hoisted roles get their own sections
  const memberGroups = useMemo(() => {
    const visible = members.filter((m) => m.id !== SYSTEM_USER_ID);
    const online = visible.filter((m) => m.status !== 'offline');
    const offline = visible.filter((m) => m.status === 'offline');

    // Collect hoisted roles from all members, keyed by id
    const hoistedMap = new Map<string, { name: string; color: string | null; position: number }>();
    for (const m of visible) {
      for (const r of m.roles ?? []) {
        if (r.is_hoisted && !hoistedMap.has(r.id)) {
          hoistedMap.set(r.id, { name: r.name, color: r.color, position: r.position });
        }
      }
    }

    const hoistedRoles = [...hoistedMap.entries()].sort((a, b) => b[1].position - a[1].position);

    if (hoistedRoles.length === 0) {
      return [
        { name: 'Online', members: online },
        { name: 'Offline', members: offline },
      ];
    }

    const groups: { name: string; color?: string; members: typeof online }[] = [];
    const assigned = new Set<string>();

    for (const [roleId, role] of hoistedRoles) {
      const roleMembers = online.filter((m) => {
        if (assigned.has(m.id)) return false;
        const highest = (m.roles ?? [])
          .filter((r) => r.is_hoisted)
          .sort((a, b) => b.position - a.position)[0];
        return highest?.id === roleId;
      });
      for (const m of roleMembers) assigned.add(m.id);
      if (roleMembers.length > 0) {
        groups.push({ name: role.name, color: role.color ?? undefined, members: roleMembers });
      }
    }

    const unhoisted = online.filter((m) => !assigned.has(m.id));
    if (unhoisted.length > 0) {
      groups.push({ name: 'Online', members: unhoisted });
    }
    groups.push({ name: 'Offline', members: offline });
    return groups;
  }, [members]);

  // Build MentionContext value from current state
  const mentionContextValue = useMemo<MentionContextValue>(() => {
    const membersMap = new Map<string, MentionMember>();
    for (const m of members) {
      if (m.id === SYSTEM_USER_ID) continue;
      membersMap.set(m.id, {
        username: m.username,
        display_name: m.display_name,
        avatar_url: m.avatar_url,
        role_color: m.role_color,
      });
    }

    const channelsMap = new Map<string, MentionChannel>();
    for (const c of channels) {
      channelsMap.set(c.id, { name: c.name, type: c.type });
    }

    const rolesMap = new Map<string, MentionRole>();
    for (const r of allRoles) {
      rolesMap.set(r.id, { name: r.name, color: r.color });
    }

    return {
      members: membersMap,
      channels: channelsMap,
      roles: rolesMap,
      serverTimezone: currentServer?.timezone,
      currentUserId: user?.id,
      onUserClick: (userId: string, rect: DOMRect) => {
        const member = members.find((m) => m.id === userId);
        if (member) {
          setProfilePopover({ member, rect });
        } else {
          setProfilePopover({
            member: { id: userId, username: 'Unknown', display_name: null, avatar_url: null, status: 'offline' as const },
            rect,
          });
        }
      },
      onChannelClick: (channelId: string) => {
        navigate(`/channels/${channelId}`);
      },
      onMOTDClick: currentServer?.motd
        ? () => useServerPopupStore.getState().showPopup(currentServer!.id)
        : undefined,
    };
  }, [members, channels, allRoles, currentServer?.timezone, currentServer?.motd, currentServer?.id, user?.id, navigate]);

  // Wire up Electron global shortcuts for mute/deafen
  useGlobalShortcuts({
    onMuteToggle: useCallback(() => {
      const { localState, setMuted } = useVoiceStore.getState();
      setMuted(!localState.isMuted);
    }, []),
    onDeafenToggle: useCallback(() => {
      const { localState, setDeafened } = useVoiceStore.getState();
      setDeafened(!localState.isDeafened);
    }, []),
  });

  // Ctrl+K command palette, Ctrl+F search shortcut
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Command palette data
  const paletteChannels = useMemo<CommandPaletteChannel[]>(
    () => channels.map((c) => ({ id: c.id, name: c.name, type: c.type as 'text' | 'voice' | 'stage', category_id: c.category_id })),
    [channels],
  );
  const paletteMembers = useMemo<CommandPaletteMember[]>(
    () => members.map((m) => ({ id: m.id, username: m.username, display_name: m.display_name, avatar_url: m.avatar_url, status: m.status, role_color: m.role_color })),
    [members],
  );
  const paletteActions = useMemo(() => [
    { id: 'settings', label: 'User Settings', sublabel: 'Open your settings', icon: 'settings' as const, action: () => setShowUserSettings(true) },
    { id: 'toggle-mute', label: 'Toggle Mute', sublabel: 'Mute or unmute your microphone', icon: 'mute' as const, action: () => { const s = useVoiceStore.getState(); s.setMuted(!s.localState.isMuted); } },
    { id: 'toggle-deafen', label: 'Toggle Deafen', sublabel: 'Deafen or undeafen audio', icon: 'deafen' as const, action: () => { const s = useVoiceStore.getState(); s.setDeafened(!s.localState.isDeafened); } },
    { id: 'dms', label: 'Direct Messages', sublabel: 'Open your DMs', icon: 'dm' as const, action: () => navigate('/channels/@me') },
    ...(voiceConnected ? [{ id: 'disconnect-voice', label: 'Disconnect Voice', sublabel: 'Leave the current voice channel', icon: 'disconnect' as const, action: () => voiceService.leave() }] : []),
  ], [navigate, voiceConnected]);

  const handlePaletteJoinVoice = useCallback((channelId: string, channelName: string) => {
    voiceService.join(channelId, channelName);
  }, []);

  const handlePaletteUserClick = useCallback(
    (member: CommandPaletteMember, rect: DOMRect) => {
      setProfilePopover({
        member: {
          id: member.id,
          username: member.username,
          display_name: member.display_name,
          avatar_url: member.avatar_url,
          status: member.status || 'offline',
          role_color: member.role_color,
        } as MemberData,
        rect,
      });
    },
    [],
  );

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary overflow-hidden">
      {/* Electron title bar — renders nothing in browser */}
      <TitleBar />

      {/* Unclaimed server banner */}
      <UnclaimedServerBanner
        isVisible={currentServer?.admin_claimed === false}
        onClaimClick={() => setShowClaimAdmin(true)}
      />

      {/* Error banner */}
      {loadError && (
        <div className="bg-danger/10 border-b border-danger/30 px-4 py-2 text-sm text-danger flex items-center justify-between">
          <span>Failed to load: {loadError}</span>
          <button onClick={() => window.location.reload()} className="text-xs underline">Reload</button>
        </div>
      )}

      {/* Main content area — adjusts for title bar height */}
      <div
        className="flex flex-1 min-h-0"
        style={{ height: 'calc(100vh - var(--title-bar-height))' }}
      >
        {/* Server List (leftmost column) */}
        <ServerList servers={servers} />

        {/* Server Sidebar (channels + voice bar + user panel) */}
        <div className="flex flex-col h-full flex-shrink-0">
          <ServerSidebar
            server={
              currentServer
                ? {
                    id: currentServer.id,
                    name: currentServer.name,
                    icon_url: currentServer.icon_url,
                    motd: currentServer.motd,
                    server_time: currentServer.server_time,
                    timezone: currentServer.timezone,
                  }
                : null
            }
            channels={channels}
            categories={categories}
            onGearClick={(pos) => setGearMenuPosition(pos)}
            onAdminClick={(pos) => setAdminMenuPosition(pos)}
            onRolePickerClick={() => setShowRolePicker(true)}
            onEventsClick={() => { setShowEventsPanel(true); setShowStorageDashboard(false); }}
            showGearButton={hasAnyAdminPermission(currentServer?.owner_id)}
            showAdminButton={hasAnyAdminPermission(currentServer?.owner_id)}
            onServerSettingsClick={() => setShowServerSettings(true)}
            onChannelSettingsClick={(channel) =>
              setSettingsChannel({
                id: channel.id,
                name: channel.name,
                type: channel.type,
                topic: channel.topic,
                bitrate: channel.bitrate,
                user_limit: channel.user_limit,
                voice_relay_policy: channel.voice_relay_policy,
                preferred_relay_id: channel.preferred_relay_id,
                server_id: currentServer?.id || '',
              })
            }
            onCreateChannel={canManageChannels() ? () => setShowServerSettings(true) : undefined}
            onChannelDoubleClick={(chId) => {
              setShowEventsPanel(false);
              setShowStorageDashboard(false);
              setIsSearchOpen(false);
              setShowServerSettings(false);
              setSettingsChannel(null);
              setShowCommandPalette(false);
              navigate(`/channels/${chId}`);
            }}
          />
          {voiceConnected && currentServer && (
            <SoundboardPanel serverId={currentServer.id} />
          )}
          <VoiceConnectedBar />
        </div>

        {/* Chat Panel / Events Panel + Member List — wrapped with MentionProvider */}
        <MentionProvider value={mentionContextValue}>
        <div className="flex-1 flex h-full min-w-0">
          {showStorageDashboard && currentServer ? (
            <StorageDashboardPanel
              onClose={() => setShowStorageDashboard(false)}
            />
          ) : showEventsPanel && currentServer ? (
            <EventsPanel
              serverId={currentServer.id}
              serverTimezone={currentServer.timezone}
              channels={channels}
              serverOwnerId={currentServer.owner_id}
              onClose={() => setShowEventsPanel(false)}
            />
          ) : (
          <ChatPanel
            channel={currentChannel}
            messages={messages}
            onSendMessage={handleSendMessage}
            onReactionAdd={handleReactionAdd}
            onReactionClick={handleReactionClick}
            onEditMessage={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
            onAuthorClick={handleAuthorClick}
            onAuthorContextMenu={handleAuthorContextMenu}
            onTypingStart={handleTypingStart}
            onTypingStop={handleTypingStop}
            currentUserId={user?.id}
            typingUsers={typingUsers}
            replyingTo={replyingTo}
            onCancelReply={() => setReplyingTo(null)}
            onReplyClick={(message) => setReplyingTo(message)}
            isMemberListOpen={isMemberListOpen}
            onToggleMemberList={handleToggleMemberList}
            onPinMessage={handlePinMessage}
            onUnpinMessage={handleUnpinMessage}
            pinnedMessageIds={pinnedMessageIds}
            isPinnedPanelOpen={isPinnedPanelOpen}
            onTogglePinnedPanel={() => setIsPinnedPanelOpen((v) => !v)}
            canManageMessages={canManageMessages()}
            onSearchOpen={() => setIsSearchOpen(true)}
            onClearMessages={() => setMessages([])}
            serverId={currentServer?.id}
            serverBannerUrl={currentServer?.banner_url}
            onCreateThread={handleCreateThread}
            threadMessageIds={threadMessageIds}
            onOpenThread={handleOpenThread}
          />
          )}

          <AnimatePresence mode="wait">
            {activeThread && (
              <motion.div
                key="thread"
                variants={slideInRight}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={easeTransition}
                className="h-full overflow-hidden flex-shrink-0"
              >
                <ThreadPanel
                  thread={activeThread}
                  currentUserId={user?.id}
                  onClose={() => setActiveThread(null)}
                  canManageThreads={canManageMessages()}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {isPinnedPanelOpen && (
              <motion.div
                key="pinned"
                variants={slideInRight}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={easeTransition}
                className="h-full overflow-hidden flex-shrink-0"
              >
                <PinnedMessagesPanel
                  channelName={currentChannel?.name || ''}
                  pinnedMessages={pinnedMessages}
                  onUnpin={handleUnpinMessage}
                  canManageMessages={canManageMessages()}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {isMemberListOpen && (
              <motion.div
                key="members"
                variants={slideInRight}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={easeTransition}
                className="h-full overflow-hidden flex-shrink-0"
              >
                <MemberList
                  groups={memberGroups}
                  ownerId={currentServer?.owner_id}
                  onMemberClick={handleMemberClick}
                  onMemberContextMenu={handleMemberContextMenu}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        </MentionProvider>
      </div>

      {/* Search Modal */}
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        channelId={channelId}
        channelName={currentChannel?.name}
        onNavigateToMessage={(chId, _msgId) => {
          if (chId !== channelId) {
            navigate(`/channels/${chId}`);
          }
          setIsSearchOpen(false);
        }}
      />

      {/* Server Gear Context Menu */}
      {currentServer && (
        <ServerGearMenu
          isOpen={!!gearMenuPosition}
          onClose={() => setGearMenuPosition(null)}
          position={gearMenuPosition || { x: 0, y: 0 }}
          serverOwnerId={currentServer.owner_id}
          onOpenSettings={(tab) => {
            setSettingsInitialTab(tab);
            setShowServerSettings(true);
            setGearMenuPosition(null);
          }}
        />
      )}

      {/* Admin Context Menu */}
      {currentServer && (
        <AdminMenu
          isOpen={!!adminMenuPosition}
          onClose={() => setAdminMenuPosition(null)}
          position={adminMenuPosition || { x: 0, y: 0 }}
          onOpenStorageDashboard={() => {
            setShowStorageDashboard(true);
            setShowEventsPanel(false);
            setAdminMenuPosition(null);
          }}
        />
      )}

      {/* Server Settings Modal */}
      {currentServer && (
        <ServerSettingsModal
          isOpen={showServerSettings}
          onClose={() => {
            setShowServerSettings(false);
            setSettingsInitialTab(undefined);
          }}
          serverName={currentServer.name}
          serverIcon={currentServer.icon_url}
          serverOwnerId={currentServer.owner_id}
          initialTab={settingsInitialTab as any}
        />
      )}

      {/* Role Picker Modal */}
      {currentServer && (
        <RolePickerModal
          isOpen={showRolePicker}
          onClose={() => setShowRolePicker(false)}
          serverId={currentServer.id}
        />
      )}

      {/* Channel Settings Modal */}
      {settingsChannel && (
        <ChannelSettingsModal
          isOpen={true}
          onClose={() => setSettingsChannel(null)}
          channel={settingsChannel}
        />
      )}

      {/* User Profile Popover */}
      {profilePopover && (
        <UserProfilePopover
          onClose={() => setProfilePopover(null)}
          anchorRect={profilePopover.rect}
          userId={profilePopover.member.id}
          username={profilePopover.member.username}
          displayName={profilePopover.member.display_name}
          avatarUrl={profilePopover.member.avatar_url}
          status={
            'status' in profilePopover.member
              ? profilePopover.member.status
              : undefined
          }
          roleColor={
            'role_color' in profilePopover.member
              ? profilePopover.member.role_color
              : undefined
          }
          customStatus={
            'custom_status' in profilePopover.member
              ? profilePopover.member.custom_status
              : undefined
          }
          isCurrentUser={profilePopover.member.id === user?.id}
          serverId={currentServer?.id}
        />
      )}

      {/* Floating User Panel (bottom-right) */}
      <FloatingUserPanel
        onSettingsClick={() => setShowUserSettings(true)}
        onDMClick={() => navigate('/channels/@me')}
        serverTimezone={currentServer?.timezone}
        userTimezone={userTimezone}
      />

      {/* Command Palette (Ctrl+K) */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        channels={paletteChannels}
        members={paletteMembers}
        onNavigateChannel={(id) => navigate(`/channels/${id}`)}
        onJoinVoice={handlePaletteJoinVoice}
        onUserClick={handlePaletteUserClick}
        quickActions={paletteActions}
      />

      {/* User Settings Modal */}
      <UserSettingsModal
        isOpen={showUserSettings}
        onClose={() => setShowUserSettings(false)}
      />

      {/* User Context Menu */}
      {contextMenu && (() => {
        const voiceState = useVoiceStore.getState();
        // Find target user in voice participants (any channel)
        let targetVoiceContext: { channelId: string; isMuted: boolean; isDeafened: boolean } | undefined;
        for (const [chId, participants] of Object.entries(voiceState.participants)) {
          const found = participants.find((p) => p.userId === contextMenu.targetUser.id);
          if (found) {
            targetVoiceContext = {
              channelId: chId,
              isMuted: found.isMuted,
              isDeafened: found.isDeafened,
            };
            break;
          }
        }
        // Get voice channels for "Move to" submenu
        const voiceChannelList = channels
          .filter((ch) => ch.type === 'voice' || ch.type === 'temp_voice' || ch.type === 'music')
          .map((ch) => ({ id: ch.id, name: ch.name }));

        return (
          <UserContextMenu
            isOpen={true}
            onClose={() => setContextMenu(null)}
            position={contextMenu.position}
            targetUser={contextMenu.targetUser}
            currentUserId={user?.id || ''}
            serverId={currentServer?.id || ''}
            serverOwnerId={currentServer?.owner_id}
            voiceContext={targetVoiceContext}
            voiceChannels={voiceChannelList}
            currentUserInVoice={voiceConnected}
            onOpenProfile={() => {
              setProfilePopover({
                member: {
                  id: contextMenu.targetUser.id,
                  username: contextMenu.targetUser.username,
                  display_name: contextMenu.targetUser.display_name ?? null,
                  avatar_url: null,
                } as MessageAuthor,
                rect: new DOMRect(
                  contextMenu.position.x,
                  contextMenu.position.y,
                  0,
                  0,
                ),
              });
              setContextMenu(null);
            }}
            onTimeout={() => {
              setTimeoutTarget(contextMenu.targetUser);
              setContextMenu(null);
            }}
            onMention={() => {
              chatInputStore.insertMention(contextMenu.targetUser.id, contextMenu.targetUser.username);
            }}
            onChangeNickname={(isSelf: boolean) => {
              const member = members.find((m) => m.id === contextMenu.targetUser.id);
              setNicknameModal({
                targetUser: contextMenu.targetUser,
                isSelf,
                currentNickname: member?.display_name || null,
                currentAdminNickname: null,
              });
            }}
            targetUserRoles={
              members.find((m) => m.id === contextMenu.targetUser.id)?.roles || []
            }
            allServerRoles={allRoles || []}
          />
        );
      })()}

      {/* Timeout Modal */}
      {timeoutTarget && currentServer && (
        <TimeoutModal
          isOpen={true}
          onClose={() => setTimeoutTarget(null)}
          targetUser={timeoutTarget}
          serverId={currentServer.id}
        />
      )}

      {/* Nickname Modal */}
      {nicknameModal && (
        <NicknameModal
          isOpen={!!nicknameModal}
          onClose={() => setNicknameModal(null)}
          targetUser={nicknameModal.targetUser}
          serverId={currentServer?.id || ''}
          isSelf={nicknameModal.isSelf}
          currentNickname={nicknameModal.currentNickname}
          currentAdminNickname={nicknameModal.currentAdminNickname}
        />
      )}

      {/* Claim Admin Modal */}
      <ClaimAdminModal
        isOpen={showClaimAdmin}
        onClose={() => setShowClaimAdmin(false)}
        onSuccess={() => {
          setShowClaimAdmin(false);
          // Refresh server data to update claimed status
          api.get<ServerData>('/server').then((server) => {
            setCurrentServer(server);
          }).catch(() => {});
        }}
      />

      {/* Server Welcome Popup */}
      <ServerWelcomePopup />

      {/* Stream Viewer (screen share) */}
      {activeStream && (
        <StreamViewer
          streamerId={activeStream.streamerId}
          streamerName={activeStream.streamerName}
          streamerAvatar={activeStream.streamerAvatar}
          channelId={activeStream.channelId}
          channelName={activeStream.channelName}
          videoElement={streamVideoElement}
          onClose={() => useStreamViewerStore.getState().leaveStream()}
        />
      )}

      {/* Version Mismatch Modal */}
      <VersionMismatchHandler />
    </div>
  );
}

function VersionMismatchHandler() {
  const versionMismatch = useSocketStore((s) => s.versionMismatch);
  return (
    <UpgradeModal
      isOpen={versionMismatch !== null}
      onDismiss={() => useSocketStore.setState({ versionMismatch: null })}
      serverVersion={versionMismatch?.serverVersion ?? ''}
      minClientVersion={versionMismatch?.minClientVersion ?? ''}
    />
  );
}
