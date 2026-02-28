import { createSignal, Show, onMount, createEffect, onCleanup } from 'solid-js';
import { useParams, useNavigate, useLocation } from '@solidjs/router';
import {
  MemberList,
  ServerSidebar,
  ChatPanel,
  FloatingUserPanel,
  DMPage,
  type Channel,
  type Category,
  type Message,
  type ChannelInfo,
  type TypingUser
} from '@/components/layout';
import { UserSettingsModal, ServerSettingsModal, ClaimAdminModal, TransferOwnershipModal, UnclaimedServerBanner, ServerWelcomePopup, StreamViewer, NotificationToast } from '@/components/ui';
import { UserProfilePopover } from '@/components/ui/UserProfilePopover';
import { UserContextMenu, type ContextMenuItem } from '@/components/ui/UserContextMenu';
import { api } from '@/api';
import { authStore } from '@/stores/auth';
import { permissions, voiceStore, serverPopupStore, messageCache } from '@/stores';
import { streamViewerStore } from '@/stores/streamViewer';
import { toastStore } from '@/stores/toastNotifications';
import { socketService } from '@/lib/socket';
import { voiceService } from '@/lib/voiceService';
import { soundService } from '@/lib/soundService';

interface Server {
  id: string;
  name: string;
  icon_url: string | null;
  owner_id: string;
  admin_claimed: boolean;
  motd?: string;
  server_time?: string; // ISO timestamp from server
  timezone?: string; // e.g., "America/New_York"
  settings?: {
    motd: string;
    motd_enabled: boolean;
  };
}

interface ServerMember {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  status: 'online' | 'idle' | 'dnd' | 'offline';
  role_color?: string | null;
  custom_status?: string | null;
  roles?: string[];
}

interface RoleInfo {
  id: string;
  name: string;
  color: string | null;
  position: number;
  is_hoisted: boolean;
}

export function MainLayout() {
  const params = useParams<{ serverId?: string; channelId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // Check if we're on the DM route (/channels/@me)
  const isDMRoute = () => location.pathname.startsWith('/channels/@me');

  const [currentServer, setCurrentServer] = createSignal<Server | null>(null);
  const [channels, setChannels] = createSignal<Channel[]>([]);
  const [categories, setCategories] = createSignal<Category[]>([]);
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [members, setMembers] = createSignal<ServerMember[]>([]);
  const [serverRoles, setServerRoles] = createSignal<RoleInfo[]>([]);
  const [currentChannel, setCurrentChannel] = createSignal<ChannelInfo | null>(null);
  const [typingUsers, setTypingUsers] = createSignal<TypingUser[]>([]);
  const [serverTimeOffset, setServerTimeOffset] = createSignal<number>(0); // Offset in minutes from local time

  // Modal states
  const [isUserSettingsOpen, setIsUserSettingsOpen] = createSignal(false);
  const [isServerSettingsOpen, setIsServerSettingsOpen] = createSignal(false);
  const [isClaimAdminOpen, setIsClaimAdminOpen] = createSignal(false);
  const [isTransferOwnershipOpen, setIsTransferOwnershipOpen] = createSignal(false);

  // Member list toggle state
  const [isMemberListOpen, setIsMemberListOpen] = createSignal(true);

  const toggleMemberList = () => setIsMemberListOpen(prev => !prev);

  // User profile popover state
  const [popoverUserId, setPopoverUserId] = createSignal<string | null>(null);
  const [popoverAnchorRect, setPopoverAnchorRect] = createSignal<DOMRect | null>(null);

  // Context menu state
  const [contextMenuUserId, setContextMenuUserId] = createSignal<string | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });

  // Fetch server details on mount
  const fetchServerData = async () => {
    try {
      // In single-server architecture, fetch the connected server info
      const server = await api.get<Server>('/server');
      setCurrentServer(server);

      // Calculate server time offset if server_time is provided
      if (server.server_time) {
        const serverTime = new Date(server.server_time).getTime();
        const localTime = Date.now();
        const offsetMs = serverTime - localTime;
        const offsetMinutes = Math.round(offsetMs / 60000);
        setServerTimeOffset(offsetMinutes);
        console.log('[MainLayout] Server time offset from /server:', offsetMinutes, 'minutes', 'timezone:', server.timezone);
      } else {
        // Fallback: try fetching from /server/time endpoint
        try {
          const timeResponse = await api.get<{ server_time: string; timezone?: string; timezone_offset?: string }>('/server/time');
          if (timeResponse.server_time) {
            const serverTime = new Date(timeResponse.server_time).getTime();
            const localTime = Date.now();
            const offsetMs = serverTime - localTime;
            const offsetMinutes = Math.round(offsetMs / 60000);
            setServerTimeOffset(offsetMinutes);
            console.log('[MainLayout] Server time offset from /server/time:', offsetMinutes, 'minutes', 'timezone:', timeResponse.timezone);
          }
        } catch (timeErr) {
          console.log('[MainLayout] /server/time endpoint not available, using local time');
        }
      }

      // Show claim admin modal if server is unclaimed
      if (!server.admin_claimed) {
        setIsClaimAdminOpen(true);
      }

      // Fetch channels - handle both array and object response formats
      const channelsResponse = await api.get<Channel[] | { channels: Channel[]; categories?: Category[] }>('/channels');

      let fetchedChannels: Channel[] = [];
      let fetchedCategories: Category[] = [];

      if (Array.isArray(channelsResponse)) {
        // Server returns array of channels directly
        fetchedChannels = channelsResponse;
        console.log('[MainLayout] Channels loaded (array format):', fetchedChannels.length);
      } else if (channelsResponse && typeof channelsResponse === 'object') {
        // Server returns object with channels and categories
        fetchedChannels = channelsResponse.channels || [];
        fetchedCategories = channelsResponse.categories || [];
        console.log('[MainLayout] Channels loaded (object format):', fetchedChannels.length, 'categories:', fetchedCategories.length);
      }

      setChannels(fetchedChannels);
      setCategories(fetchedCategories);

      // Fetch members - handle both array and object response formats
      const membersResponse = await api.get<ServerMember[] | { members: ServerMember[] }>('/members');

      let fetchedMembers: ServerMember[] = [];
      if (Array.isArray(membersResponse)) {
        fetchedMembers = membersResponse;
        console.log('[MainLayout] Members loaded (array format):', fetchedMembers.length);
      } else if (membersResponse && typeof membersResponse === 'object' && 'members' in membersResponse) {
        fetchedMembers = membersResponse.members || [];
        console.log('[MainLayout] Members loaded (object format):', fetchedMembers.length);
      }

      // Debug: log first member to see structure
      if (fetchedMembers.length > 0) {
        console.log('[MainLayout] First member sample:', JSON.stringify(fetchedMembers[0], null, 2));
      }

      // Normalize members to ensure all fields exist
      const normalizedMembers = fetchedMembers.map(m => {
        const rawMember = m as any;
        const user = rawMember.user || rawMember; // Handle nested user object

        // Normalize status: server might return "active" instead of "online"
        const rawStatus = user.status || rawMember.status || rawMember.presence || m.status || 'offline';
        const normalizedStatus = rawStatus === 'active' ? 'online' :
          rawStatus === 'inactive' ? 'offline' :
            (['online', 'idle', 'dnd', 'offline'].includes(rawStatus) ? rawStatus : 'offline');

        return {
          id: user.id || rawMember.user_id || m.id || 'unknown',
          username: user.username || rawMember.name || m.username || 'Unknown',
          display_name: user.display_name || user.displayName || m.display_name || null,
          avatar_url: user.avatar_url || user.avatarUrl || user.avatar || m.avatar_url || null,
          status: normalizedStatus as 'online' | 'idle' | 'dnd' | 'offline',
          role_color: user.role_color || user.roleColor || m.role_color || null,
          custom_status: user.custom_status || rawMember.custom_status || m.custom_status || null,
          roles: rawMember.roles || m.roles || [],
        } as ServerMember;
      });

      setMembers(normalizedMembers);

      // Fetch roles for hoisted role grouping in member list
      try {
        const rolesResponse = await api.get<RoleInfo[]>('/roles');
        if (Array.isArray(rolesResponse)) {
          setServerRoles(rolesResponse);
        }
      } catch (err) {
        console.error('[MainLayout] Failed to fetch roles:', err);
      }

      // Fetch voice participants for all channels to show who's in voice
      try {
        const voiceResponse = await api.get<{ channels: Record<string, Array<{
          user_id: string;
          username: string;
          display_name: string | null;
          avatar_url: string | null;
          is_muted: boolean;
          is_deafened: boolean;
          is_streaming?: boolean;
        }>> }>('/voice/participants');
        
        if (voiceResponse.channels) {
          for (const [channelId, participants] of Object.entries(voiceResponse.channels)) {
            const voiceParticipants = participants.map(p => ({
              userId: p.user_id,
              username: p.username,
              displayName: p.display_name,
              avatarUrl: p.avatar_url,
              isMuted: p.is_muted,
              isDeafened: p.is_deafened,
              isSpeaking: false,
              isStreaming: p.is_streaming || false,
            }));
            voiceStore.setChannelParticipants(channelId, voiceParticipants);
          }
          console.log('[MainLayout] Voice participants loaded for', Object.keys(voiceResponse.channels).length, 'channels');
        }
      } catch (voiceErr) {
        console.warn('[MainLayout] Failed to fetch voice participants:', voiceErr);
      }

      // Auto-rejoin voice channel if we were in one before page refresh
      try {
        const rejoined = await voiceService.attemptAutoRejoin();
        if (rejoined) {
          console.log('[MainLayout] Successfully auto-rejoined voice channel');
        }
      } catch (rejoinErr) {
        console.warn('[MainLayout] Failed to auto-rejoin voice channel:', rejoinErr);
      }

      // Auto-navigate to first channel if none selected and we have channels (but not on DM route)
      if (!params.channelId && !isDMRoute() && fetchedChannels.length > 0) {
        const firstTextChannel = fetchedChannels.find((c) => c.type === 'text');
        if (firstTextChannel) {
          console.log('[MainLayout] Auto-navigating to first text channel:', firstTextChannel.name);
          navigate(`/channels/${firstTextChannel.id}`);
        }
      }
    } catch (err) {
      console.error('[MainLayout] Failed to fetch server data:', err);
    }
  };

  onMount(fetchServerData);

  // Server welcome popup integration - show on authentication (any page)
  createEffect(() => {
    const server = currentServer();
    const user = authStore.state().user;
    const isAuthenticated = authStore.state().isAuthenticated;

    console.log('[MainLayout] Popup trigger check:', {
      isAuthenticated,
      hasUser: !!user,
      hasServer: !!server,
      path: location.pathname
    });

    // Show popup when authenticated (on any page, not just DM route)
    // The 24-hour check is handled inside serverPopupStore.showPopup()
    if (!isAuthenticated || !user || !server) {
      return;
    }

    // Debounce to handle rapid navigation changes (500ms)
    const debounceTimer = setTimeout(() => {
      console.log('[MainLayout] Attempting to show popup for server:', server.id);
      // Check if popup should be shown (will check 24h timestamp internally)
      serverPopupStore.showPopup(server.id);
    }, 500);

    onCleanup(() => clearTimeout(debounceTimer));
  });

  // Reset popup on logout
  createEffect(() => {
    const isAuthenticated = authStore.state().isAuthenticated;

    if (!isAuthenticated) {
      serverPopupStore.reset();
    }
  });

  // Auto-navigate to first channel when on /channels/ without a channelId
  createEffect(() => {
    const path = location.pathname;
    const channelId = params.channelId;
    const allChannels = channels();

    // If on /channels/ (not @me) with no channelId, navigate to first channel
    if ((path === '/channels/' || path === '/channels') && !channelId && allChannels.length > 0) {
      const firstTextChannel = allChannels.find(c => c.type === 'text');
      if (firstTextChannel) {
        navigate(`/channels/${firstTextChannel.id}`, { replace: true });
      }
    }
  });

  // Socket event handler for presence updates
  createEffect(() => {
    const handlePresenceUpdate = (data: {
      user_id: string;
      status: 'online' | 'idle' | 'dnd' | 'offline';
      custom_status?: string | null;
      avatar_url?: string | null;
    }) => {
      // Update member list
      setMembers(prev => prev.map(m => {
        if (m.id !== data.user_id) return m;
        return {
          ...m,
          status: data.status,
          custom_status: data.custom_status ?? m.custom_status,
          avatar_url: data.avatar_url !== undefined ? data.avatar_url : m.avatar_url,
        };
      }));

      // Update own status/avatar in auth store if it's the current user
      const currentUserId = authStore.state().user?.id;
      if (data.user_id === currentUserId) {
        authStore.updateStatus(data.status);
        if (data.custom_status !== undefined) {
          authStore.updateCustomStatus(data.custom_status, null);
        }
        if (data.avatar_url !== undefined) {
          authStore.updateAvatarUrl(data.avatar_url);
        }
      }
    };

    socketService.on('presence.update', handlePresenceUpdate);

    onCleanup(() => {
      socketService.off('presence.update', handlePresenceUpdate as any);
    });
  });

  // Socket event handler for new messages (real-time)
  createEffect(() => {
    const channelId = params.channelId;

    const handleNewMessage = (rawMessage: any) => {
      console.log('[MainLayout] Received message:new event:', rawMessage);

      // Only add message if we're viewing the channel it was sent to
      const messageChannelId = rawMessage.channel_id;
      if (messageChannelId && messageChannelId !== channelId) {
        console.log('[MainLayout] Ignoring message for different channel:', messageChannelId, 'vs current:', channelId);
        return;
      }

      // Check if author object exists and has required fields
      const hasValidAuthor = rawMessage.author && rawMessage.author.id && rawMessage.author.username;

      const author = hasValidAuthor ? rawMessage.author : {
        id: rawMessage.author?.id || rawMessage.author_id || rawMessage.user_id || 'unknown',
        username: rawMessage.author?.username || rawMessage.author_username || rawMessage.username || 'Unknown User',
        display_name: rawMessage.author?.display_name || rawMessage.author_display_name || rawMessage.display_name || null,
        avatar_url: rawMessage.author?.avatar_url || rawMessage.author_avatar_url || rawMessage.avatar_url || null
      };

      const message: Message = { ...rawMessage, author };

      // Don't duplicate messages we sent ourselves (already added optimistically)
      if (message.author.id === authStore.state().user?.id) {
        console.log('[MainLayout] Ignoring own message (already added optimistically)');
        return;
      }

      console.log('[MainLayout] Adding message to chat:', message.id, 'author:', message.author.username);
      setMessages(prev => [...prev, message]);

      // Also update the cache (invalidates hash so next fetch will check server)
      if (messageChannelId) {
        messageCache.appendMessage(messageChannelId, message);
      }

      // Play notification sound if user is mentioned
      const currentUsername = authStore.state().user?.username;
      if (currentUsername && message.content?.includes(`@${currentUsername}`)) {
        soundService.playNotification();
      }
    };

    socketService.on('message.new', handleNewMessage);

    onCleanup(() => {
      socketService.off('message.new', handleNewMessage);
    });
  });

  // Socket event handlers for typing indicators
  createEffect(() => {
    const channelId = params.channelId;
    if (!channelId) return;

    const handleTypingStart = (data: { channel_id: string; user?: TypingUser; user_id?: string }) => {
      if (data.channel_id !== channelId) return;

      // Handle both old format (user_id) and new format (user object)
      const user = data.user || (data.user_id ? {
        id: data.user_id,
        username: 'Someone',
        display_name: null
      } : null);

      if (!user) return;

      // Don't show own typing
      if (user.id === authStore.state().user?.id) return;

      setTypingUsers(prev => {
        if (prev.some(u => u.id === user.id)) return prev;
        return [...prev, user];
      });
    };

    const handleTypingStop = (data: { channel_id: string; user_id: string }) => {
      if (data.channel_id !== channelId) return;
      setTypingUsers(prev => prev.filter(u => u.id !== data.user_id));
    };

    socketService.on('typing.start', handleTypingStart);
    socketService.on('typing.stop', handleTypingStop);

    onCleanup(() => {
      socketService.off('typing.start', handleTypingStart as any);
      socketService.off('typing.stop', handleTypingStop as any);
      setTypingUsers([]);
    });
  });

  // Socket event handlers for server updates
  createEffect(() => {
    const handleServerUpdate = (data: { server: Server }) => {
      console.log('[MainLayout] Server updated:', data.server.name);
      setCurrentServer(data.server);
    };

    socketService.on('server.update', handleServerUpdate);

    onCleanup(() => {
      socketService.off('server.update', handleServerUpdate as any);
    });
  });

  // Socket event handlers for channel changes
  createEffect(() => {
    const handleChannelCreate = (data: { channel: Channel }) => {
      console.log('[MainLayout] Channel created:', data.channel.name);
      setChannels(prev => [...prev, data.channel]);
    };

    const handleChannelUpdate = (data: { channel: Channel }) => {
      console.log('[MainLayout] Channel updated:', data.channel.name);
      setChannels(prev => prev.map(c =>
        c.id === data.channel.id ? data.channel : c
      ));
      // Update current channel if it's the one being viewed
      if (currentChannel()?.id === data.channel.id) {
        setCurrentChannel({
          id: data.channel.id,
          name: data.channel.name,
          type: data.channel.type,
          topic: data.channel.topic
        });
      }
    };

    const handleChannelDelete = (data: { channel_id: string }) => {
      console.log('[MainLayout] Channel deleted:', data.channel_id);
      setChannels(prev => prev.filter(c => c.id !== data.channel_id));
      // Navigate away if we're viewing the deleted channel
      if (params.channelId === data.channel_id) {
        const remainingChannels = channels().filter(c => c.id !== data.channel_id);
        const firstTextChannel = remainingChannels.find(c => c.type === 'text');
        if (firstTextChannel) {
          navigate(`/channels/${firstTextChannel.id}`, { replace: true });
        } else {
          navigate('/channels', { replace: true });
        }
      }
    };

    socketService.on('channel.create', handleChannelCreate);
    socketService.on('channel.update', handleChannelUpdate);
    socketService.on('channel.delete', handleChannelDelete);

    onCleanup(() => {
      socketService.off('channel.create', handleChannelCreate as any);
      socketService.off('channel.update', handleChannelUpdate as any);
      socketService.off('channel.delete', handleChannelDelete as any);
    });
  });

  // Socket event handlers for category changes
  createEffect(() => {
    const handleCategoryCreate = (data: { category: Category }) => {
      console.log('[MainLayout] Category created:', data.category.name);
      setCategories(prev => [...prev, data.category]);
    };

    const handleCategoryUpdate = (data: { category: Category }) => {
      console.log('[MainLayout] Category updated:', data.category.name);
      setCategories(prev => prev.map(c =>
        c.id === data.category.id ? data.category : c
      ));
    };

    const handleCategoryDelete = (data: { category_id: string }) => {
      console.log('[MainLayout] Category deleted:', data.category_id);
      setCategories(prev => prev.filter(c => c.id !== data.category_id));
    };

    socketService.on('category.create', handleCategoryCreate);
    socketService.on('category.update', handleCategoryUpdate);
    socketService.on('category.delete', handleCategoryDelete);

    onCleanup(() => {
      socketService.off('category.create', handleCategoryCreate as any);
      socketService.off('category.update', handleCategoryUpdate as any);
      socketService.off('category.delete', handleCategoryDelete as any);
    });
  });

  // Socket event handlers for member changes
  createEffect(() => {
    const handleMemberJoin = (data: { member: ServerMember }) => {
      console.log('[MainLayout] Member joined:', data.member.username);
      setMembers(prev => {
        // Avoid duplicates
        if (prev.some(m => m.id === data.member.id)) return prev;
        return [...prev, data.member];
      });
    };

    const handleMemberLeave = (data: { user_id: string }) => {
      console.log('[MainLayout] Member left:', data.user_id);
      setMembers(prev => prev.filter(m => m.id !== data.user_id));
    };

    const handleMemberUpdate = (data: { member: Partial<ServerMember> & { id: string } }) => {
      console.log('[MainLayout] Member updated:', data.member.id);
      setMembers(prev => prev.map(m =>
        m.id === data.member.id ? { ...m, ...data.member } : m
      ));
    };

    socketService.on('member.join', handleMemberJoin);
    socketService.on('member.leave', handleMemberLeave);
    socketService.on('member.update', handleMemberUpdate);

    onCleanup(() => {
      socketService.off('member.join', handleMemberJoin as any);
      socketService.off('member.leave', handleMemberLeave as any);
      socketService.off('member.update', handleMemberUpdate as any);
    });
  });

  // Socket event handlers for message updates and reactions
  createEffect(() => {
    const channelId = params.channelId;

    const handleMessageUpdate = (data: { message: Message; channel_id: string }) => {
      if (data.channel_id !== channelId) return;
      console.log('[MainLayout] Message updated:', data.message.id);
      setMessages(prev => prev.map(m =>
        m.id === data.message.id ? data.message : m
      ));
      // Update cache as well
      messageCache.updateMessage(data.channel_id, data.message.id, () => data.message);
    };

    const handleMessageDelete = (data: { message_id: string; channel_id: string }) => {
      if (data.channel_id !== channelId) return;
      console.log('[MainLayout] Message deleted:', data.message_id);
      setMessages(prev => prev.filter(m => m.id !== data.message_id));
      // Update cache as well
      messageCache.removeMessage(data.channel_id, data.message_id);
    };

    const handleMessageReaction = (data: {
      message_id: string;
      channel_id: string;
      emoji: string;
      user_id: string;
      action: 'add' | 'remove'
    }) => {
      if (data.channel_id !== channelId) return;
      // Don't process our own reactions (already handled optimistically)
      if (data.user_id === authStore.state().user?.id) return;

      console.log('[MainLayout] Reaction sync:', data.action, data.emoji, 'from', data.user_id);
      setMessages(prev => prev.map(m => {
        if (m.id !== data.message_id) return m;

        const reactions = [...(m.reactions || [])];
        const existingIndex = reactions.findIndex(r => r.emoji === data.emoji);

        if (data.action === 'add') {
          if (existingIndex >= 0) {
            // Add user to existing reaction
            const existing = reactions[existingIndex];
            if (!existing.users.includes(data.user_id)) {
              reactions[existingIndex] = {
                ...existing,
                count: existing.count + 1,
                users: [...existing.users, data.user_id]
              };
            }
          } else {
            // Create new reaction
            reactions.push({
              emoji: data.emoji,
              count: 1,
              users: [data.user_id],
              me: false
            });
          }
        } else if (data.action === 'remove' && existingIndex >= 0) {
          const existing = reactions[existingIndex];
          if (existing.count <= 1) {
            reactions.splice(existingIndex, 1);
          } else {
            reactions[existingIndex] = {
              ...existing,
              count: existing.count - 1,
              users: existing.users.filter(u => u !== data.user_id)
            };
          }
        }

        return { ...m, reactions };
      }));
      // Invalidate cache hash so next fetch will check server
      messageCache.updateMessage(data.channel_id, data.message_id, (msg) => msg);
    };

    socketService.on('message.update', handleMessageUpdate);
    socketService.on('message.delete', handleMessageDelete);
    socketService.on('message.reaction', handleMessageReaction);

    onCleanup(() => {
      socketService.off('message.update', handleMessageUpdate as any);
      socketService.off('message.delete', handleMessageDelete as any);
      socketService.off('message.reaction', handleMessageReaction as any);
    });
  });

  // Socket event handlers for voice channels
  createEffect(() => {
    const handleVoiceUserJoined = (data: {
      channel_id: string;
      user: {
        id: string;
        username: string;
        display_name?: string | null;
        avatar_url?: string | null;
      };
      custom_sound_url?: string | null;
    }) => {
      console.log('[MainLayout] Voice user joined:', data.user.username, 'in channel:', data.channel_id);
      voiceStore.addParticipant(data.channel_id, data.user);

      // Play join sound if we're in the same channel and it's not us
      const currentUserId = authStore.state().user?.id;
      const currentChannelId = voiceStore.currentChannelId();
      if (currentChannelId === data.channel_id && data.user.id !== currentUserId) {
        if (data.custom_sound_url) {
          soundService.playCustomSound(data.custom_sound_url);
        } else {
          soundService.playVoiceJoin();
        }

        // Stream viewer notification: if WE are streaming, play stream-join for host
        if (voiceStore.isScreenSharing()) {
          soundService.playStreamJoin();
        }
      }
    };

    const handleVoiceUserLeft = (data: { channel_id: string; user_id: string; custom_sound_url?: string | null }) => {
      console.log('[MainLayout] Voice user left:', data.user_id, 'from channel:', data.channel_id);
      voiceStore.removeParticipant(data.channel_id, data.user_id);

      // Play leave sound if we're in the same channel and it's not us
      const currentUserId = authStore.state().user?.id;
      const currentChannelId = voiceStore.currentChannelId();
      if (currentChannelId === data.channel_id && data.user_id !== currentUserId) {
        if (data.custom_sound_url) {
          soundService.playCustomSound(data.custom_sound_url);
        } else {
          soundService.playVoiceLeave();
        }

        // Stream viewer notification: if WE are streaming, play stream-leave for host
        if (voiceStore.isScreenSharing()) {
          soundService.playStreamLeave();
        }
      }
    };

    const handleVoiceMuteUpdate = (data: {
      channel_id: string;
      user_id: string;
      is_muted: boolean;
      is_deafened: boolean;
      is_streaming?: boolean;
    }) => {
      console.log('[MainLayout] Voice state update:', data.user_id, 'muted:', data.is_muted, 'deafened:', data.is_deafened, 'streaming:', data.is_streaming);
      
      // Build update object, only including isStreaming if explicitly provided
      const updates: { isMuted: boolean; isDeafened: boolean; isStreaming?: boolean } = {
        isMuted: data.is_muted,
        isDeafened: data.is_deafened,
      };
      
      // Only update streaming state if it was explicitly included in the event
      if (data.is_streaming !== undefined) {
        updates.isStreaming = data.is_streaming;
      }
      
      voiceStore.updateParticipantState(data.channel_id, data.user_id, updates);
    };

    const handleVoiceForceMove = async (data: { to_channel_id: string; to_channel_name?: string }) => {
      console.log('[MainLayout] Force moved to channel:', data.to_channel_id);
      const channelName = data.to_channel_name || channels().find(c => c.id === data.to_channel_id)?.name || 'Voice Channel';
      await voiceService.handleForceMove(data.to_channel_id, channelName);
    };

    const handleVoiceForceDisconnect = () => {
      console.log('[MainLayout] Force disconnected from voice');
      voiceService.leave();
    };

    socketService.on('voice.join', handleVoiceUserJoined);
    socketService.on('voice.leave', handleVoiceUserLeft);
    socketService.on('voice.state_update', handleVoiceMuteUpdate);
    socketService.on('voice.force_move', handleVoiceForceMove);
    socketService.on('voice.force_disconnect', handleVoiceForceDisconnect);

    onCleanup(() => {
      socketService.off('voice.join', handleVoiceUserJoined as any);
      socketService.off('voice.leave', handleVoiceUserLeft as any);
      socketService.off('voice.state_update', handleVoiceMuteUpdate as any);
      socketService.off('voice.force_move', handleVoiceForceMove as any);
      socketService.off('voice.force_disconnect', handleVoiceForceDisconnect as any);
    });
  });

  // Cleanup voice connection on navigation away or unmount
  createEffect(() => {
    onCleanup(() => {
      if (voiceStore.isConnected()) {
        console.log('[MainLayout] Cleaning up voice connection on unmount');
        voiceService.leave();
      }
    });
  });

  // Socket event handler for DM toast notifications
  createEffect(() => {
    const handleDMMessage = (data: { from_user_id: string; message: any }) => {
      const currentUserId = authStore.state().user?.id;
      // Don't show toast for own messages
      if (data.message?.author?.id === currentUserId) return;
      // Only show toast if not currently on the DM route
      if (!isDMRoute()) {
        const author = data.message?.author;
        toastStore.addToast({
          type: 'dm',
          title: author?.display_name || author?.username || 'Unknown',
          message: (data.message?.content || '').slice(0, 100),
          avatarUrl: author?.avatar_url,
          onClick: () => navigate('/channels/@me'),
        });
        soundService.playNotification();
      }
    };

    socketService.on('dm.message.new', handleDMMessage);
    onCleanup(() => socketService.off('dm.message.new', handleDMMessage as any));
  });

  // Socket event handler for soundboard play
  createEffect(() => {
    const handleSoundboardPlay = (data: { sound_url: string; sound_name: string; played_by: string }) => {
      console.log('[MainLayout] Soundboard play:', data.sound_name, 'by', data.played_by);
      soundService.playCustomSound(data.sound_url);
    };

    socketService.on('soundboard.play', handleSoundboardPlay);
    onCleanup(() => socketService.off('soundboard.play', handleSoundboardPlay as any));
  });

  // Socket event handler for member warnings
  createEffect(() => {
    const handleMemberWarn = (data: {
      server_id: string;
      server_name: string;
      reason?: string;
      moderator_username?: string;
    }) => {
      toastStore.addToast({
        type: 'warning' as any,
        title: `Warning from ${data.server_name}`,
        message: data.reason || 'You have been warned by a moderator.',
        duration: 10000,
      });
    };

    socketService.on('member.warn', handleMemberWarn);
    onCleanup(() => socketService.off('member.warn', handleMemberWarn as any));
  });

  // Socket event handlers for server mute/deafen
  createEffect(() => {
    const handleServerMute = (data: {
      channel_id: string;
      muted: boolean;
      muted_by: string;
    }) => {
      voiceService.setServerMuted(data.muted);
      toastStore.addToast({
        type: 'system',
        title: data.muted ? 'Server Muted' : 'Server Unmuted',
        message: data.muted
          ? 'A moderator has muted you.'
          : 'You have been unmuted by a moderator.',
        duration: 5000,
      });
    };

    const handleServerDeafen = (data: {
      channel_id: string;
      deafened: boolean;
      deafened_by: string;
    }) => {
      voiceService.setServerDeafened(data.deafened);
      toastStore.addToast({
        type: 'system',
        title: data.deafened ? 'Server Deafened' : 'Server Undeafened',
        message: data.deafened
          ? 'A moderator has deafened you.'
          : 'You have been undeafened by a moderator.',
        duration: 5000,
      });
    };

    socketService.on('voice.server_mute', handleServerMute);
    socketService.on('voice.server_deafen', handleServerDeafen);
    onCleanup(() => {
      socketService.off('voice.server_mute', handleServerMute as any);
      socketService.off('voice.server_deafen', handleServerDeafen as any);
    });
  });

  // Fetch channel data when channelId changes (with hash-based caching)
  createEffect(async () => {
    const channelId = params.channelId;
    if (!channelId || channelId === '@me' || isDMRoute()) {
      setCurrentChannel(null);
      setMessages([]);
      return;
    }

    try {
      // Find the channel info
      const channel = channels().find(c => c.id === channelId);
      if (channel) {
        setCurrentChannel({
          id: channel.id,
          name: channel.name,
          topic: channel.topic,
          type: channel.type
        });
      }

      // Check cache first - immediately show cached messages if available
      const cached = messageCache.get(channelId);
      if (cached) {
        setMessages(cached.messages);
      }

      // Build request headers for conditional fetch
      const headers: Record<string, string> = {};
      if (cached?.hash) {
        headers['If-None-Match'] = cached.hash;
      }

      // Fetch messages with conditional request
      const messagesResponse = await api.get<{ messages: Message[]; hash: string } | null>(
        `/channels/${channelId}/messages`,
        { headers }
      );

      // If response is null (304 Not Modified), cache is valid - nothing more to do
      if (messagesResponse === null) {
        console.log('[MainLayout] Cache hit for channel:', channelId);
        return;
      }

      // Extract messages and hash from response
      let fetchedMessages: Message[] = [];
      let responseHash = '';
      
      if (messagesResponse && typeof messagesResponse === 'object') {
        if ('messages' in messagesResponse) {
          fetchedMessages = messagesResponse.messages || [];
          responseHash = messagesResponse.hash || '';
        } else if (Array.isArray(messagesResponse)) {
          // Fallback for legacy array response
          fetchedMessages = messagesResponse as unknown as Message[];
        }
      }

      // Normalize messages to ensure author object exists with all required fields
      const normalizedMessages = fetchedMessages.map(msg => {
        const rawMsg = msg as any;

        // Check if author object exists and has required fields
        const hasValidAuthor = msg.author && msg.author.id && msg.author.username;

        const author = hasValidAuthor ? msg.author : {
          id: rawMsg.author?.id || rawMsg.author_id || rawMsg.user_id || 'unknown',
          username: rawMsg.author?.username || rawMsg.author_username || rawMsg.username || 'Unknown User',
          display_name: rawMsg.author?.display_name || rawMsg.author_display_name || rawMsg.display_name || null,
          avatar_url: rawMsg.author?.avatar_url || rawMsg.author_avatar_url || rawMsg.avatar_url || null
        };

        return { ...msg, author };
      });

      // Update cache and state
      if (responseHash) {
        messageCache.set(channelId, normalizedMessages, responseHash);
      }
      setMessages(normalizedMessages);

    } catch (err) {
      console.error('Failed to fetch channel data:', err);
    }
  });

  // Debounced ACK effect - only send after user stays in channel for 2 seconds
  createEffect(() => {
    const channelId = params.channelId;
    if (!channelId || channelId === '@me' || isDMRoute()) return;

    // Debounce ACK - only send after user stays 2 seconds in the channel
    const timer = setTimeout(async () => {
      try {
        await api.post(`/channels/${channelId}/ack`);
        // Update local channel state to reflect 0 unread count
        setChannels(prev => prev.map(c =>
          c.id === channelId ? { ...c, unread_count: 0, has_mentions: false } : c
        ));
      } catch (ackErr) {
        console.error('[MainLayout] Failed to mark channel as read:', ackErr);
      }
    }, 2000);

    onCleanup(() => clearTimeout(timer));
  });

  const handleSettingsClick = () => {
    setIsUserSettingsOpen(true);
  };

  const handleServerSettingsClick = () => {
    setIsServerSettingsOpen(true);
  };

  const handleTransferOwnershipClick = () => {
    setIsServerSettingsOpen(false);
    setIsTransferOwnershipOpen(true);
  };

  const handleDMClick = () => {
    navigate('/channels/@me');
  };

  const handleSendMessage = async (content: string) => {
    const channelId = params.channelId;
    if (!channelId || channelId === '@me' || isDMRoute() || !content.trim()) return;

    try {
      const rawMessage = await api.post<any>(`/channels/${channelId}/messages`, { content });

      // Get current user for fallback
      const currentUser = authStore.state().user;

      // Check if author object exists and has required fields
      const hasValidAuthor = rawMessage.author && rawMessage.author.id && rawMessage.author.username;

      const author = hasValidAuthor ? rawMessage.author : {
        id: rawMessage.author?.id || rawMessage.author_id || currentUser?.id || 'unknown',
        username: rawMessage.author?.username || rawMessage.author_username || currentUser?.username || 'Unknown User',
        display_name: rawMessage.author?.display_name || rawMessage.author_display_name || currentUser?.display_name || null,
        avatar_url: rawMessage.author?.avatar_url || rawMessage.author_avatar_url || currentUser?.avatar_url || null
      };

      const newMessage: Message = { ...rawMessage, author };

      console.log('[MainLayout] Message sent:', newMessage.id, 'author:', author.username);
      setMessages(prev => [...prev, newMessage]);
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  const handleReactionAdd = async (messageId: string, emoji: string) => {
    console.log('[MainLayout] Adding reaction:', emoji, 'to message:', messageId);

    // Optimistically update UI first
    const userId = authStore.state().user?.id || '';
    setMessages(prev => prev.map(msg => {
      if (msg.id !== messageId) return msg;
      const reactions = [...(msg.reactions || [])];
      const existingReaction = reactions.find(r => r.emoji === emoji);

      if (existingReaction) {
        return {
          ...msg,
          reactions: reactions.map(r =>
            r.emoji === emoji
              ? { ...r, count: r.count + 1, users: [...r.users, userId], me: true }
              : r
          )
        };
      } else {
        return { ...msg, reactions: [...reactions, { emoji, count: 1, users: [userId], me: true }] };
      }
    }));

    try {
      await api.put(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, {});
      console.log('[MainLayout] Reaction added successfully');
    } catch (err) {
      console.error('[MainLayout] Failed to add reaction:', err);
      // Revert on failure
      setMessages(prev => prev.map(msg => {
        if (msg.id !== messageId) return msg;
        const reactions = [...(msg.reactions || [])];
        const existingReaction = reactions.find(r => r.emoji === emoji);

        if (existingReaction && existingReaction.count > 1) {
          return {
            ...msg,
            reactions: reactions.map(r =>
              r.emoji === emoji
                ? { ...r, count: r.count - 1, users: r.users.filter(u => u !== userId), me: false }
                : r
            )
          };
        } else {
          return { ...msg, reactions: reactions.filter(r => r.emoji !== emoji) };
        }
      }));
    }
  };

  const handleReactionRemove = async (messageId: string, emoji: string) => {
    console.log('[MainLayout] Removing reaction:', emoji, 'from message:', messageId);

    const userId = authStore.state().user?.id || '';

    // Store the old state for potential revert
    const oldMessages = messages();

    // Optimistically update UI first
    setMessages(prev => prev.map(msg => {
      if (msg.id !== messageId) return msg;
      const reactions = [...(msg.reactions || [])];
      const existingReaction = reactions.find(r => r.emoji === emoji);

      if (existingReaction) {
        if (existingReaction.count <= 1) {
          return { ...msg, reactions: reactions.filter(r => r.emoji !== emoji) };
        }
        return {
          ...msg,
          reactions: reactions.map(r =>
            r.emoji === emoji
              ? { ...r, count: r.count - 1, users: r.users.filter(u => u !== userId), me: false }
              : r
          )
        };
      }
      return msg;
    }));

    try {
      await api.delete(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
      console.log('[MainLayout] Reaction removed successfully');
    } catch (err) {
      console.error('[MainLayout] Failed to remove reaction:', err);
      // Revert on failure
      setMessages(oldMessages);
    }
  };

  const handleTypingStart = () => {
    const channelId = params.channelId;
    if (!channelId) return;
    socketService.emit('typing.start', { channel_id: channelId });
  };

  const handleTypingStop = () => {
    const channelId = params.channelId;
    if (!channelId) return;
    socketService.emit('typing.stop', { channel_id: channelId });
  };

  // Group members by hoisted roles (online) + generic Online + Offline
  const memberGroups = () => {
    const ownerId = currentServer()?.owner_id;
    const online = members().filter(m => m.status !== 'offline');
    const offline = members().filter(m => m.status === 'offline');
    const roles = serverRoles();

    // Get hoisted roles sorted by position DESC (highest first)
    const hoistedRoles = roles
      .filter(r => r.is_hoisted && r.name !== '@everyone')
      .sort((a, b) => b.position - a.position);

    if (hoistedRoles.length === 0) {
      // No hoisted roles — simple online/offline split
      return [
        { name: 'Online', members: online, ownerId },
        { name: 'Offline', members: offline, ownerId },
      ];
    }

    // Build a map of roleId -> role position for quick lookup
    const rolePositionMap = new Map<string, number>();
    for (const r of roles) {
      rolePositionMap.set(r.id, r.position);
    }

    // For each online member, find their highest-position hoisted role
    const hoistedGroupMap = new Map<string, ServerMember[]>();
    const ungroupedOnline: ServerMember[] = [];

    for (const member of online) {
      const memberRoles = member.roles || [];
      // Find the highest-position hoisted role this member has
      let bestHoisted: RoleInfo | null = null;
      for (const roleId of memberRoles) {
        const hoisted = hoistedRoles.find(r => r.id === roleId);
        if (hoisted && (!bestHoisted || hoisted.position > bestHoisted.position)) {
          bestHoisted = hoisted;
        }
      }

      if (bestHoisted) {
        const group = hoistedGroupMap.get(bestHoisted.id) || [];
        group.push(member);
        hoistedGroupMap.set(bestHoisted.id, group);
      } else {
        ungroupedOnline.push(member);
      }
    }

    // Build groups array: hoisted roles (with members) -> Online -> Offline
    const groups: { name: string; color?: string; members: ServerMember[]; ownerId?: string }[] = [];

    for (const role of hoistedRoles) {
      const roleMembers = hoistedGroupMap.get(role.id);
      if (roleMembers && roleMembers.length > 0) {
        groups.push({
          name: role.name,
          color: role.color || undefined,
          members: roleMembers,
          ownerId,
        });
      }
    }

    if (ungroupedOnline.length > 0) {
      groups.push({ name: 'Online', members: ungroupedOnline, ownerId });
    }

    groups.push({ name: 'Offline', members: offline, ownerId });

    return groups;
  };

  // User profile popover helpers
  const getUserInfo = (userId: string) => {
    const member = members().find(m => m.id === userId);
    const channelId = voiceStore.currentChannelId();
    const voiceParticipant = channelId
      ? voiceStore.getParticipants(channelId).find(p => p.userId === userId)
      : null;

    return {
      username: member?.username || voiceParticipant?.username || 'Unknown',
      displayName: member?.display_name || voiceParticipant?.displayName || null,
      avatarUrl: member?.avatar_url || voiceParticipant?.avatarUrl || null,
      status: (member?.status || 'offline') as 'online' | 'idle' | 'dnd' | 'offline',
      roleColor: member?.role_color || null,
      customStatus: member?.custom_status || null,
    };
  };

  const isUserInVoice = (userId: string): boolean => {
    const channelId = voiceStore.currentChannelId();
    if (!channelId) return false;
    return voiceStore.getParticipants(channelId).some(p => p.userId === userId);
  };

  const handleUserPopoverOpen = (userId: string, rect: DOMRect) => {
    setPopoverUserId(userId);
    setPopoverAnchorRect(rect);
  };

  const handleUserContextMenu = (userId: string, e: MouseEvent) => {
    e.preventDefault();
    setContextMenuUserId(userId);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  const closePopover = () => {
    setPopoverUserId(null);
    setPopoverAnchorRect(null);
  };

  const closeContextMenu = () => {
    setContextMenuUserId(null);
  };

  // Volume signal for context menu slider
  const [ctxVolume, setCtxVolume] = createSignal(100);

  const getContextMenuItems = (userId: string): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    const isCurrentUser = userId === authStore.state().user?.id;
    const perms = voiceStore.permissions();
    const currentChannelId = voiceStore.currentChannelId();
    const isTargetInVoice = currentChannelId
      ? voiceStore.getParticipants(currentChannelId).some(p => p.userId === userId)
      : false;
    const serverId = currentServer()?.id;

    // Profile
    items.push({
      label: 'Profile',
      icon: (
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
      onClick: () => {
        const rect = new DOMRect(
          contextMenuPosition().x,
          contextMenuPosition().y,
          0,
          0,
        );
        handleUserPopoverOpen(userId, rect);
      },
    });

    // Voice controls (only when target is in voice and not self)
    if (!isCurrentUser && isTargetInVoice) {
      // Volume slider
      setCtxVolume(voiceService.getUserVolume(userId));
      items.push({
        label: 'Volume',
        separator: true,
        onClick: () => {},
        customRender: () => (
          <div class="flex items-center gap-2 w-full">
            <svg class="w-4 h-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
            <input
              type="range"
              min={0}
              max={200}
              value={ctxVolume()}
              onInput={(e) => {
                const val = parseInt(e.currentTarget.value);
                setCtxVolume(val);
                voiceService.setUserVolume(userId, val);
              }}
              class="flex-1 h-1.5 accent-brand-primary cursor-pointer"
            />
            <span class="text-xs text-text-muted w-9 text-right">{ctxVolume()}%</span>
          </div>
        ),
      });

      // Local Mute
      items.push({
        label: voiceService.isLocallyMuted(userId) ? 'Unmute (Local)' : 'Mute (Local)',
        icon: (
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
          </svg>
        ),
        onClick: () => voiceService.toggleLocalMute(userId),
      });

      // Server Mute (admin)
      if (perms?.canMuteMembers) {
        items.push({
          label: 'Server Mute',
          separator: true,
          icon: (
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 1a3 3 0 00-3 3v4a3 3 0 006 0V4a3 3 0 00-3-3z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4l16 16" />
            </svg>
          ),
          onClick: () => {
            if (currentChannelId) {
              voiceService.serverMuteMember(userId, currentChannelId, true);
            }
          },
        });
      }

      // Server Deafen (admin)
      if (perms?.canDeafenMembers) {
        items.push({
          label: 'Server Deafen',
          icon: (
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4l16 16" />
            </svg>
          ),
          onClick: () => {
            if (currentChannelId) {
              voiceService.serverDeafenMember(userId, currentChannelId, true);
            }
          },
        });
      }

      // Move to Channel (admin)
      if (perms?.canMoveMembers) {
        const voiceChannels = channels().filter(
          (c) =>
            ['voice', 'temp_voice', 'music'].includes(c.type) && c.id !== currentChannelId,
        );
        for (const vc of voiceChannels) {
          items.push({
            label: `Move to ${vc.name}`,
            icon: (
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            ),
            onClick: () => {
              if (currentChannelId) {
                voiceService.moveMember(userId, currentChannelId, vc.id);
              }
            },
          });
        }
      }

      // Disconnect (admin)
      if (perms?.canDisconnectMembers) {
        items.push({
          label: 'Disconnect',
          separator: true,
          danger: true,
          icon: (
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          ),
          onClick: () => {
            if (currentChannelId) {
              voiceService.disconnectMember(userId, currentChannelId);
            }
          },
        });
      }
    }

    // Moderation actions (non-voice, always available with perms)
    if (!isCurrentUser && serverId) {
      const canWarn =
        permissions.isAdmin() || permissions.hasPermission('moderate_members');

      if (canWarn) {
        items.push({
          label: 'Warn',
          separator: !isTargetInVoice,
          warning: true,
          icon: (
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          ),
          onClick: async () => {
            const reason = prompt('Reason for warning (optional):');
            if (reason === null) return; // cancelled
            try {
              await api.post(`/servers/${serverId}/members/${userId}/warn`, {
                reason: reason || undefined,
              });
            } catch (err: any) {
              console.error('Failed to warn member:', err);
            }
          },
        });
      }

      if (permissions.canKickMembers()) {
        items.push({
          label: 'Kick',
          separator: !canWarn && !isTargetInVoice,
          danger: true,
          icon: (
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" />
            </svg>
          ),
          onClick: async () => {
            if (!confirm('Are you sure you want to kick this member?')) return;
            try {
              await api.post(`/servers/${serverId}/members/${userId}/kick`, {});
            } catch (err: any) {
              console.error('Failed to kick member:', err);
            }
          },
        });
      }

      if (permissions.canBanMembers()) {
        items.push({
          label: 'Ban',
          danger: true,
          icon: (
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          ),
          onClick: async () => {
            if (!confirm('Are you sure you want to ban this member?')) return;
            try {
              await api.post(`/servers/${serverId}/members/${userId}/ban`, {});
            } catch (err: any) {
              console.error('Failed to ban member:', err);
            }
          },
        });
      }
    }

    return items;
  };

  // Check if current user can access server settings
  const canAccessSettings = () => {
    const server = currentServer();
    if (!server) return false;
    // Check owner, admin, or manage_server permission
    return permissions.isOwner(server.owner_id) || permissions.canManageServer(server.owner_id);
  };

  return (
    <div class="flex flex-col h-screen w-screen overflow-hidden bg-bg-primary">
      {/* Unclaimed Server Banner - only show when not on DM route */}
      <Show when={!isDMRoute()}>
        <UnclaimedServerBanner
          isVisible={currentServer()?.admin_claimed === false}
          onClaimClick={() => setIsClaimAdminOpen(true)}
        />
      </Show>

      <div class="flex flex-1 overflow-hidden">
        {/* DM Page - shown when on /channels/@me */}
        <Show when={isDMRoute()}>
          <DMPage />
        </Show>

        {/* Server Layout - shown when NOT on DM route */}
        <Show when={!isDMRoute()}>
          {/* Left Sidebar - Server info, MOTD, Channels */}
          <ServerSidebar
            server={currentServer()}
            channels={channels()}
            categories={categories()}
            onServerSettingsClick={canAccessSettings() ? handleServerSettingsClick : undefined}
            onUserClick={handleUserPopoverOpen}
            onUserContextMenu={handleUserContextMenu}
          />

          {/* Main content area - Chat with optional Stream Viewer overlay */}
          <div class="flex-1 flex flex-col min-w-0 relative">
            {/* Chat Panel - always rendered */}
            <ChatPanel
              channel={currentChannel()}
              messages={messages()}
              onSendMessage={handleSendMessage}
              onReactionAdd={handleReactionAdd}
              onReactionRemove={handleReactionRemove}
              onTypingStart={handleTypingStart}
              onTypingStop={handleTypingStop}
              currentUserId={authStore.state().user?.id}
              typingUsers={typingUsers()}
              isMemberListOpen={isMemberListOpen()}
              onToggleMemberList={toggleMemberList}
            />
            
          </div>

          {/* Right Sidebar - Member List (collapsible) */}
          <Show when={params.channelId && isMemberListOpen()}>
            <MemberList
              groups={memberGroups()}
              ownerId={currentServer()?.owner_id}
              onMemberClick={(member, rect) => handleUserPopoverOpen(member.id, rect)}
              onMemberContextMenu={(member, e) => handleUserContextMenu(member.id, e)}
            />
          </Show>
        </Show>
      </div>

      {/* Floating User Panel (bottom-right) - hidden on DM route */}
      <Show when={!isDMRoute()}>
        <FloatingUserPanel
          onSettingsClick={handleSettingsClick}
          onDMClick={handleDMClick}
          serverTimeOffset={serverTimeOffset()}
        />
      </Show>

      {/* Settings Modals */}
      <UserSettingsModal
        isOpen={isUserSettingsOpen()}
        onClose={() => setIsUserSettingsOpen(false)}
      />
      <ServerSettingsModal
        isOpen={isServerSettingsOpen()}
        onClose={() => setIsServerSettingsOpen(false)}
        serverName={currentServer()?.name || 'Server'}
        serverIcon={currentServer()?.icon_url}
        serverOwnerId={currentServer()?.owner_id}
        onTransferOwnership={handleTransferOwnershipClick}
      />

      {/* Claim Admin Modal */}
      <ClaimAdminModal
        isOpen={isClaimAdminOpen()}
        onClose={() => setIsClaimAdminOpen(false)}
        onSuccess={async () => {
          // Refresh both server data and user data (for updated permissions)
          await Promise.all([
            fetchServerData(),
            authStore.refreshUser()
          ]);
        }}
      />

      {/* Transfer Ownership Modal */}
      <TransferOwnershipModal
        isOpen={isTransferOwnershipOpen()}
        onClose={() => setIsTransferOwnershipOpen(false)}
        members={members()}
        currentOwnerId={currentServer()?.owner_id || ''}
        onTransferComplete={fetchServerData}
      />

      {/* Hidden audio container for voice chat */}
      <div
        id="voice-audio-container"
        class="hidden"
        ref={(el) => {
          if (el) {
            voiceService.setAudioContainer(el);
          }
        }}
      />

      {/* Server Welcome Popup */}
      <ServerWelcomePopup />

      {/* Toast Notifications (DM alerts, etc.) */}
      <NotificationToast />

      {/* User Profile Popover */}
      <Show when={popoverUserId() && popoverAnchorRect()}>
        {(_) => {
          const userId = popoverUserId()!;
          const info = getUserInfo(userId);
          const perms = voiceStore.permissions();
          return (
            <UserProfilePopover
              onClose={closePopover}
              anchorRect={popoverAnchorRect()!}
              userId={userId}
              username={info.username}
              displayName={info.displayName}
              avatarUrl={info.avatarUrl}
              status={info.status}
              roleColor={info.roleColor}
              customStatus={info.customStatus}
              isInVoice={isUserInVoice(userId)}
              voiceChannelId={voiceStore.currentChannelId() || undefined}
              canMoveMembers={perms?.canMoveMembers}
              canDisconnectMembers={perms?.canDisconnectMembers}
              canMuteMembers={perms?.canMuteMembers}
              canDeafenMembers={perms?.canDeafenMembers}
              canKickMembers={permissions.canKickMembers()}
              canBanMembers={permissions.canBanMembers()}
              canWarnMembers={permissions.isAdmin() || permissions.hasPermission('moderate_members')}
              isCurrentUser={userId === authStore.state().user?.id}
              serverId={currentServer()?.id}
              voiceChannels={channels().filter(c => ['voice', 'temp_voice', 'music'].includes(c.type)).map(c => ({ id: c.id, name: c.name }))}
              onSendMessage={() => navigate('/channels/@me')}
            />
          );
        }}
      </Show>

      {/* User Context Menu */}
      <Show when={contextMenuUserId()}>
        <UserContextMenu
          isOpen={!!contextMenuUserId()}
          onClose={closeContextMenu}
          position={contextMenuPosition()}
          items={getContextMenuItems(contextMenuUserId()!)}
        />
      </Show>

      {/* Stream Viewer - full-screen overlay for watching streams */}
      <Show when={streamViewerStore.activeStream()}>
        {(stream) => (
          <StreamViewer
            streamerId={stream().streamerId}
            streamerName={stream().streamerName}
            streamerAvatar={stream().streamerAvatar}
            channelId={stream().channelId}
            channelName={stream().channelName}
            videoElement={streamViewerStore.videoElement()}
            onClose={streamViewerStore.leaveStream}
          />
        )}
      </Show>

      {/* Minimized stream indicator bar - shows when stream is minimized */}
      <Show when={streamViewerStore.activeStream() && streamViewerStore.isMinimized()}>
        {(_stream) => (
          <div class="fixed bottom-0 left-0 right-0 z-[60] bg-gray-900 border-t border-gray-700 px-4 py-2 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="flex items-center gap-2 bg-red-600 rounded px-2 py-1">
                <span class="w-2 h-2 bg-white rounded-full animate-pulse" />
                <span class="text-white text-xs font-semibold">LIVE</span>
              </div>
              <div class="flex items-center gap-2">
                <svg class="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
                <span class="text-white text-sm">
                  Listening to {streamViewerStore.activeStream()?.streamerName}'s stream
                </span>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button
                onClick={() => streamViewerStore.maximizeStream()}
                class="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg font-medium transition-colors flex items-center gap-2"
                title="Expand Stream"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                </svg>
                Expand
              </button>
              <button
                onClick={() => streamViewerStore.leaveStream()}
                class="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg font-medium transition-colors"
                title="Leave Stream"
              >
                Leave
              </button>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
