import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuthStore } from '@/stores/auth';
import { useServerPopupStore } from '@/stores/serverPopup';
import { socketService } from '@/lib/socket';
import { ServerList } from '@/components/layout/ServerList';
import { ServerSidebar } from '@/components/layout/ServerSidebar';
import { ChatPanel, type Message, type ChannelInfo, type TypingUser } from '@/components/layout/ChatPanel';
import { MemberList } from '@/components/layout/MemberList';
import { UserPanel } from '@/components/layout/UserPanel';
import { TitleBar } from '@/components/ui/TitleBar';
import { useGlobalShortcuts } from '@/hooks/useElectron';
import { slideInRight, easeTransition } from '@/lib/motion';
import type { Channel, Category } from '@/components/layout/ChannelList';

interface ServerData {
  id: string;
  name: string;
  icon_url: string | null;
  owner_id: string;
  motd?: string;
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
  const user = useAuthStore((s) => s.user);
  const showPopup = useServerPopupStore((s) => s.showPopup);

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

  // Fetch server list on mount
  useEffect(() => {
    const handleServerList = (data: { servers: ServerData[] }) => {
      setServers(data.servers);
      if (data.servers.length > 0 && !currentServer) {
        const first = data.servers[0];
        setCurrentServer(first);
        socketService.emit('server.join', { server_id: first.id });
        showPopup(first.id);
      }
    };

    const handleServerData = (data: {
      server: ServerData;
      channels: Channel[];
      categories?: Category[];
      members: MemberData[];
    }) => {
      setCurrentServer(data.server);
      setChannels(data.channels);
      setCategories(data.categories || []);
      setMembers(data.members);

      // Auto-select first text channel if no channel selected
      if (!channelId) {
        const firstText = data.channels
          .filter((c) => c.type === 'text')
          .sort((a, b) => a.position - b.position)[0];
        if (firstText) {
          setCurrentChannel({ id: firstText.id, name: firstText.name, topic: firstText.topic, type: firstText.type });
          socketService.emit('channel.join', { channel_id: firstText.id });
        }
      }
    };

    socketService.on('server.list', handleServerList as (data: unknown) => void);
    socketService.on('server.data', handleServerData as (data: unknown) => void);
    socketService.emit('server.list');

    return () => {
      socketService.off('server.list', handleServerList as (data: unknown) => void);
      socketService.off('server.data', handleServerData as (data: unknown) => void);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle channel selection changes
  useEffect(() => {
    if (!channelId) return;

    const channel = channels.find((c) => c.id === channelId);
    if (channel) {
      setCurrentChannel({ id: channel.id, name: channel.name, topic: channel.topic, type: channel.type });
      socketService.emit('channel.join', { channel_id: channel.id });
    }
  }, [channelId, channels]);

  // Wire up message events
  useEffect(() => {
    const handleMessages = (data: { messages: Message[] }) => {
      setMessages(data.messages);
    };

    const handleNewMessage = (message: Message) => {
      setMessages((prev) => [...prev, message]);
      setTypingUsers((prev) => prev.filter((u) => u.id !== message.author.id));
    };

    const handleMessageUpdate = (data: { id: string; content: string; edited_at: string }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === data.id ? { ...m, content: data.content, edited_at: data.edited_at } : m))
      );
    };

    const handleMessageDelete = (data: { id: string }) => {
      setMessages((prev) => prev.filter((m) => m.id !== data.id));
    };

    socketService.on('channel.messages', handleMessages as (data: unknown) => void);
    socketService.on('message.create', handleNewMessage as (data: unknown) => void);
    socketService.on('message.update', handleMessageUpdate as (data: unknown) => void);
    socketService.on('message.delete', handleMessageDelete as (data: unknown) => void);

    return () => {
      socketService.off('channel.messages', handleMessages as (data: unknown) => void);
      socketService.off('message.create', handleNewMessage as (data: unknown) => void);
      socketService.off('message.update', handleMessageUpdate as (data: unknown) => void);
      socketService.off('message.delete', handleMessageDelete as (data: unknown) => void);
    };
  }, []);

  // Wire up typing events
  useEffect(() => {
    const handleTypingStart = (data: { user_id: string; username: string }) => {
      if (data.user_id === user?.id) return;
      setTypingUsers((prev) => {
        if (prev.some((u) => u.id === data.user_id)) return prev;
        return [...prev, { id: data.user_id, username: data.username }];
      });
      setTimeout(() => {
        setTypingUsers((prev) => prev.filter((u) => u.id !== data.user_id));
      }, 5000);
    };

    const handleTypingStop = (data: { user_id: string }) => {
      setTypingUsers((prev) => prev.filter((u) => u.id !== data.user_id));
    };

    socketService.on('typing.start', handleTypingStart as (data: unknown) => void);
    socketService.on('typing.stop', handleTypingStop as (data: unknown) => void);

    return () => {
      socketService.off('typing.start', handleTypingStart as (data: unknown) => void);
      socketService.off('typing.stop', handleTypingStop as (data: unknown) => void);
    };
  }, [user?.id]);

  // Wire up member events
  useEffect(() => {
    const handleMemberUpdate = (data: MemberData) => {
      setMembers((prev) => prev.map((m) => (m.id === data.id ? { ...m, ...data } : m)));
    };

    const handleMemberJoin = (data: MemberData) => {
      setMembers((prev) => [...prev.filter((m) => m.id !== data.id), data]);
    };

    const handleMemberLeave = (data: { user_id: string }) => {
      setMembers((prev) => prev.filter((m) => m.id !== data.user_id));
    };

    socketService.on('member.update', handleMemberUpdate as (data: unknown) => void);
    socketService.on('member.join', handleMemberJoin as (data: unknown) => void);
    socketService.on('member.leave', handleMemberLeave as (data: unknown) => void);

    return () => {
      socketService.off('member.update', handleMemberUpdate as (data: unknown) => void);
      socketService.off('member.join', handleMemberJoin as (data: unknown) => void);
      socketService.off('member.leave', handleMemberLeave as (data: unknown) => void);
    };
  }, []);

  // Action handlers
  const handleSendMessage = useCallback((content: string) => {
    if (!currentChannel) return;
    socketService.emit('message.create', { channel_id: currentChannel.id, content });
  }, [currentChannel]);

  const handleTypingStart = useCallback(() => {
    if (!currentChannel) return;
    socketService.emit('typing.start', { channel_id: currentChannel.id });
  }, [currentChannel]);

  const handleTypingStop = useCallback(() => {
    if (!currentChannel) return;
    socketService.emit('typing.stop', { channel_id: currentChannel.id });
  }, [currentChannel]);

  const handleReactionAdd = useCallback((messageId: string, emoji: string) => {
    socketService.emit('reaction.add', { message_id: messageId, emoji });
  }, []);

  const handleReactionRemove = useCallback((messageId: string, emoji: string) => {
    socketService.emit('reaction.remove', { message_id: messageId, emoji });
  }, []);

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
  // TODO: Connect to voice store when voice state management is wired up
  useGlobalShortcuts({
    onMuteToggle: useCallback(() => {
      console.log('[MainLayout] Global shortcut: toggle mute');
    }, []),
    onDeafenToggle: useCallback(() => {
      console.log('[MainLayout] Global shortcut: toggle deafen');
    }, []),
  });

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary overflow-hidden">
      {/* Electron title bar — renders nothing in browser */}
      <TitleBar />

      {/* Main content area — adjusts for title bar height */}
      <div className="flex flex-1 min-h-0" style={{ height: 'calc(100vh - var(--title-bar-height))' }}>
        {/* Server List (leftmost column) */}
        <ServerList servers={servers} onCreateServer={() => {}} />

        {/* Server Sidebar (channels + user panel) */}
        <div className="flex flex-col h-full">
          <ServerSidebar
            server={currentServer ? {
              id: currentServer.id,
              name: currentServer.name,
              icon_url: currentServer.icon_url,
              motd: currentServer.motd,
            } : null}
            channels={channels}
            categories={categories}
          />
          <UserPanel />
        </div>

        {/* Chat Panel + Member List */}
        <div className="flex-1 flex h-full min-w-0">
          <ChatPanel
            channel={currentChannel}
            messages={messages}
            onSendMessage={handleSendMessage}
            onReactionAdd={handleReactionAdd}
            onReactionRemove={handleReactionRemove}
            onTypingStart={handleTypingStart}
            onTypingStop={handleTypingStop}
            currentUserId={user?.id}
            typingUsers={typingUsers}
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
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
