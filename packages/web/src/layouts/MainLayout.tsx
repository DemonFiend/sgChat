import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
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
import { useVoiceStore } from '@/stores/voice';
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
import { UserContextMenu, type ContextMenuItem } from '@/components/ui/UserContextMenu';
import { UserProfilePopover } from '@/components/ui/UserProfilePopover';
import { UserSettingsModal } from '@/components/ui/UserSettingsModal';
import { FloatingUserPanel } from '@/components/layout/FloatingUserPanel';
import { ServerWelcomePopup } from '@/components/ui/ServerWelcomePopup';
import { UnclaimedServerBanner } from '@/components/ui/UnclaimedServerBanner';
import { ClaimAdminModal } from '@/components/ui/ClaimAdminModal';
import { StreamViewer } from '@/components/ui/StreamViewer';
import { useStreamViewerStore } from '@/stores/streamViewer';
import { SoundboardPanel } from '@/components/ui/SoundboardPanel';
import { VoiceConnectedBar } from '@/components/ui/VoiceConnectedBar';
import { useGlobalShortcuts } from '@/hooks/useElectron';
import { canManageChannels } from '@/stores/permissions';
import { slideInRight, easeTransition } from '@/lib/motion';
import type { Channel, Category } from '@/components/layout/ChannelList';

interface ServerData {
  id: string;
  name: string;
  icon_url: string | null;
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
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [isMemberListOpen, setIsMemberListOpen] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modal & popover state
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [settingsChannel, setSettingsChannel] = useState<{
    id: string;
    name: string;
    type: string;
    topic?: string;
    server_id: string;
  } | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [profilePopover, setProfilePopover] = useState<{
    member: MemberData | MessageAuthor;
    rect: DOMRect;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    member: MemberData;
    position: { x: number; y: number };
  } | null>(null);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showClaimAdmin, setShowClaimAdmin] = useState(false);

  // Server time offset (minutes) for FloatingUserPanel
  const serverTimeOffset = useMemo(() => {
    if (!currentServer?.server_time) return 0;
    return Math.round((new Date(currentServer.server_time).getTime() - Date.now()) / 60000);
  }, [currentServer?.server_time]);

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

        // Fetch members
        const membersResponse = await api.get<
          MemberData[] | { members: MemberData[] }
        >('/members');
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
    };

    const handleMessageUpdate = (data: {
      id: string;
      content: string;
      edited_at: string;
    }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.id
            ? { ...m, content: data.content, edited_at: data.edited_at }
            : m,
        ),
      );
    };

    const handleMessageDelete = (data: { id: string }) => {
      setMessages((prev) => prev.filter((m) => m.id !== data.id));
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

    return () => {
      socketService.off(
        'voice.join',
        handleVoiceJoin as (data: unknown) => void,
      );
      socketService.off(
        'voice.leave',
        handleVoiceLeave as (data: unknown) => void,
      );
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
    };

    const handleChannelDelete = (data: any) => {
      const deletedId = data.channel?.id || data.id;
      setChannels((prev) => prev.filter((c) => c.id !== deletedId));
    };

    socketService.on('server.update', handleServerUpdate as (data: unknown) => void);
    socketService.on('presence.update', handlePresenceUpdate as (data: unknown) => void);
    socketService.on('channel.create', handleChannelCreate as (data: unknown) => void);
    socketService.on('channel.update', handleChannelUpdate as (data: unknown) => void);
    socketService.on('channel.delete', handleChannelDelete as (data: unknown) => void);

    return () => {
      socketService.off('server.update', handleServerUpdate as (data: unknown) => void);
      socketService.off('presence.update', handlePresenceUpdate as (data: unknown) => void);
      socketService.off('channel.create', handleChannelCreate as (data: unknown) => void);
      socketService.off('channel.update', handleChannelUpdate as (data: unknown) => void);
      socketService.off('channel.delete', handleChannelDelete as (data: unknown) => void);
    };
  }, [user?.id]);

  // ── Action handlers (correct socket event names) ───────────────
  const handleSendMessage = useCallback(
    (content: string) => {
      if (!currentChannel) return;
      // Backend expects 'message:send' (colon separator)
      socketService.emit('message:send', {
        channel_id: currentChannel.id,
        content,
        ...(replyingTo?.id ? { reply_to_id: replyingTo.id } : {}),
      });
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
  const handleReactionAdd = useCallback(
    (messageId: string, emoji: string) => {
      api
        .put(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`)
        .catch((err) =>
          console.error('[MainLayout] Failed to add reaction:', err),
        );
    },
    [],
  );

  const handleReactionRemove = useCallback(
    (messageId: string, emoji: string) => {
      api
        .delete(
          `/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
        )
        .catch((err) =>
          console.error('[MainLayout] Failed to remove reaction:', err),
        );
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
      setContextMenu({ member, position: { x: e.clientX, y: e.clientY } });
    },
    [],
  );

  const handleToggleMemberList = useCallback(() => {
    setIsMemberListOpen((prev) => !prev);
  }, []);

  // Group members for MemberList — hoisted roles get their own sections
  const memberGroups = useMemo(() => {
    const online = members.filter((m) => m.status !== 'offline');
    const offline = members.filter((m) => m.status === 'offline');

    // Collect hoisted roles from all members, keyed by id
    const hoistedMap = new Map<string, { name: string; color: string | null; position: number }>();
    for (const m of members) {
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
    for (const m of members) {
      for (const r of m.roles ?? []) {
        if (!rolesMap.has(r.id)) {
          rolesMap.set(r.id, { name: r.name, color: r.color });
        }
      }
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
  }, [members, channels, currentServer?.timezone, currentServer?.motd, currentServer?.id, user?.id, navigate]);

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
            onServerSettingsClick={() => setShowServerSettings(true)}
            onChannelSettingsClick={(channel) =>
              setSettingsChannel({
                id: channel.id,
                name: channel.name,
                type: channel.type,
                topic: channel.topic,
                server_id: currentServer?.id || '',
              })
            }
            onCreateChannel={canManageChannels() ? () => setShowServerSettings(true) : undefined}
          />
          {voiceConnected && currentServer && (
            <SoundboardPanel serverId={currentServer.id} />
          )}
          <VoiceConnectedBar />
        </div>

        {/* Chat Panel + Member List — wrapped with MentionProvider */}
        <MentionProvider value={mentionContextValue}>
        <div className="flex-1 flex h-full min-w-0">
          <ChatPanel
            channel={currentChannel}
            messages={messages}
            onSendMessage={handleSendMessage}
            onReactionAdd={handleReactionAdd}
            onReactionRemove={handleReactionRemove}
            onEditMessage={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
            onAuthorClick={handleAuthorClick}
            onTypingStart={handleTypingStart}
            onTypingStop={handleTypingStop}
            currentUserId={user?.id}
            typingUsers={typingUsers}
            replyingTo={replyingTo}
            onCancelReply={() => setReplyingTo(null)}
            onReplyClick={(message) => setReplyingTo(message)}
            isMemberListOpen={isMemberListOpen}
            onToggleMemberList={handleToggleMemberList}
          />

          <AnimatePresence mode="wait">
            {isMemberListOpen && (
              <motion.div
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

      {/* Server Settings Modal */}
      {currentServer && (
        <ServerSettingsModal
          isOpen={showServerSettings}
          onClose={() => setShowServerSettings(false)}
          serverName={currentServer.name}
          serverIcon={currentServer.icon_url}
          serverOwnerId={currentServer.owner_id}
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
        serverTimeOffset={serverTimeOffset}
      />

      {/* User Settings Modal */}
      <UserSettingsModal
        isOpen={showUserSettings}
        onClose={() => setShowUserSettings(false)}
      />

      {/* User Context Menu */}
      {contextMenu && (
        <UserContextMenu
          isOpen={true}
          onClose={() => setContextMenu(null)}
          position={contextMenu.position}
          items={[
            {
              label: 'Profile',
              onClick: () => {
                setProfilePopover({
                  member: contextMenu.member,
                  rect: new DOMRect(
                    contextMenu.position.x,
                    contextMenu.position.y,
                    0,
                    0,
                  ),
                });
                setContextMenu(null);
              },
            },
            { label: 'Message', onClick: () => setContextMenu(null) },
            ...(currentServer?.owner_id === user?.id &&
            contextMenu.member.id !== user?.id
              ? ([
                  { label: '', separator: true, onClick: () => {} },
                  {
                    label: 'Kick',
                    danger: true,
                    onClick: () => {
                      api
                        .post(
                          `/members/${contextMenu.member.id}/kick`,
                        )
                        .catch(() => {});
                      setContextMenu(null);
                    },
                  },
                ] as ContextMenuItem[])
              : []),
          ]}
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
    </div>
  );
}
