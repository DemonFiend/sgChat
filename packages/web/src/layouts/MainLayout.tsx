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
import { UserSettingsModal, ServerSettingsModal, ClaimAdminModal, TransferOwnershipModal, UnclaimedServerBanner } from '@/components/ui';
import { api } from '@/api';
import { authStore } from '@/stores/auth';
import { permissions, voiceStore } from '@/stores';
import { socketService } from '@/lib/socket';
import { voiceService } from '@/lib/voiceService';

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
          custom_status: user.custom_status || rawMember.custom_status || m.custom_status || null
        } as ServerMember;
      });
      
      setMembers(normalizedMembers);

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
    const handlePresenceUpdate = (data: { user_id: string; status: 'online' | 'idle' | 'dnd' | 'offline'; custom_status?: string | null }) => {
      // Update member list
      setMembers(prev => prev.map(m => 
        m.id === data.user_id ? { ...m, status: data.status, custom_status: data.custom_status ?? m.custom_status } : m
      ));
      
      // Update own status in auth store if it's the current user
      const currentUserId = authStore.state().user?.id;
      if (data.user_id === currentUserId) {
        authStore.updateStatus(data.status);
        if (data.custom_status !== undefined) {
          authStore.updateCustomStatus(data.custom_status, null);
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
    };

    const handleMessageDelete = (data: { message_id: string; channel_id: string }) => {
      if (data.channel_id !== channelId) return;
      console.log('[MainLayout] Message deleted:', data.message_id);
      setMessages(prev => prev.filter(m => m.id !== data.message_id));
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
    }) => {
      console.log('[MainLayout] Voice user joined:', data.user.username, 'in channel:', data.channel_id);
      voiceStore.addParticipant(data.channel_id, data.user);
    };

    const handleVoiceUserLeft = (data: { channel_id: string; user_id: string }) => {
      console.log('[MainLayout] Voice user left:', data.user_id, 'from channel:', data.channel_id);
      voiceStore.removeParticipant(data.channel_id, data.user_id);
    };

    const handleVoiceMuteUpdate = (data: { 
      channel_id: string; 
      user_id: string; 
      is_muted: boolean; 
      is_deafened: boolean;
    }) => {
      console.log('[MainLayout] Voice mute update:', data.user_id, 'muted:', data.is_muted, 'deafened:', data.is_deafened);
      voiceStore.updateParticipantState(data.channel_id, data.user_id, {
        isMuted: data.is_muted,
        isDeafened: data.is_deafened,
      });
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

  // Fetch channel data when channelId changes
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

      // Fetch messages - handle both array and object response formats
      const messagesResponse = await api.get<Message[] | { messages: Message[] }>(`/channels/${channelId}/messages`);
      
      let fetchedMessages: Message[] = [];
      if (Array.isArray(messagesResponse)) {
        fetchedMessages = messagesResponse;
      } else if (messagesResponse && typeof messagesResponse === 'object' && 'messages' in messagesResponse) {
        fetchedMessages = messagesResponse.messages || [];
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
      
      console.log('[MainLayout] Messages loaded:', normalizedMessages.length);
      if (normalizedMessages.length > 0) {
        console.log('[MainLayout] First message sample:', JSON.stringify(normalizedMessages[0], null, 2));
      }
      setMessages(normalizedMessages);
    } catch (err) {
      console.error('Failed to fetch channel data:', err);
    }
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
    socketService.emit('typing:start', { channel_id: channelId });
  };

  const handleTypingStop = () => {
    const channelId = params.channelId;
    if (!channelId) return;
    socketService.emit('typing:stop', { channel_id: channelId });
  };

  // Group members by status and add owner info
  const memberGroups = () => {
    const ownerId = currentServer()?.owner_id;
    const online = members().filter(m => m.status !== 'offline');
    const offline = members().filter(m => m.status === 'offline');
    return [
      { name: 'Online', members: online, ownerId },
      { name: 'Offline', members: offline, ownerId },
    ];
  };

  // Check if current user can access server settings
  const canAccessSettings = () => {
    const server = currentServer();
    if (!server) return false;
    return permissions.isOwner(server.owner_id) || permissions.isAdmin();
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
          />

          {/* Main content area - Chat */}
          <div class="flex-1 flex flex-col min-w-0">
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
            <MemberList groups={memberGroups()} ownerId={currentServer()?.owner_id} />
          </Show>
        </Show>
      </div>

      {/* Floating User Panel (bottom-right) */}
      <FloatingUserPanel
        onSettingsClick={handleSettingsClick}
        onDMClick={handleDMClick}
        serverTimeOffset={serverTimeOffset()}
      />

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
        onSuccess={fetchServerData}
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
    </div>
  );
}
