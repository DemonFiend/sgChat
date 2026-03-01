import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuthStore } from '@/stores/auth';
import { useServerPopupStore } from '@/stores/serverPopup';
import { useVoiceStore } from '@/stores/voice';
import { socketService } from '@/lib/socket';
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
import { UserPanel } from '@/components/layout/UserPanel';
import { TitleBar } from '@/components/ui/TitleBar';
import { ServerSettingsModal } from '@/components/ui/ServerSettingsModal';
import { ChannelSettingsModal } from '@/components/ui/ChannelSettingsModal';
import { VoiceConnectedBar } from '@/components/ui/VoiceConnectedBar';
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

interface MemberData {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  status: 'online' | 'idle' | 'dnd' | 'offline';
  role_color?: string | null;
  custom_status?: string | null;
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
  useEffect(() => {
    if (!channelId) return;

    // Find the channel in our loaded list
    const channel = channels.find((c) => c.id === channelId);
    if (channel) {
      setCurrentChannel({
        id: channel.id,
        name: channel.name,
        topic: channel.topic,
        type: channel.type,
      });
    } else if (channels.length > 0) {
      // channelId doesn't match any channel (e.g. server ID from ServerList click)
      // → auto-redirect to first text channel
      const firstText = channels
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
  }, [channelId, channels, navigate]);

  // ── Wire up real-time message events (correct event names) ─────
  useEffect(() => {
    const handleNewMessage = (message: Message & { channel_id?: string }) => {
      // Only show messages for the current channel
      if (message.channel_id && message.channel_id !== channelId) return;
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
    const handleTypingStart = (data: {
      user_id: string;
      username: string;
    }) => {
      if (data.user_id === user?.id) return;
      setTypingUsers((prev) => {
        if (prev.some((u) => u.id === data.user_id)) return prev;
        return [...prev, { id: data.user_id, username: data.username }];
      });
      setTimeout(() => {
        setTypingUsers((prev) =>
          prev.filter((u) => u.id !== data.user_id),
        );
      }, 5000);
    };

    const handleTypingStop = (data: { user_id: string }) => {
      setTypingUsers((prev) => prev.filter((u) => u.id !== data.user_id));
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

  // Group members for MemberList
  const memberGroups = (() => {
    const online = members.filter((m) => m.status !== 'offline');
    const offline = members.filter((m) => m.status === 'offline');
    return [
      { name: 'Online', members: online },
      { name: 'Offline', members: offline },
    ];
  })();

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
        <div className="flex flex-col h-full">
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
          <VoiceConnectedBar />
          {voiceConnected && currentServer && (
            <SoundboardPanel serverId={currentServer.id} />
          )}
          <UserPanel onSettingsClick={() => setShowUserSettings(true)} />
        </div>

        {/* Chat Panel + Member List */}
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
            onToggleMemberList={() => setIsMemberListOpen(!isMemberListOpen)}
          />

          <AnimatePresence>
            {isMemberListOpen && (
              <motion.div
                variants={slideInRight}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={easeTransition}
                className="h-full"
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
