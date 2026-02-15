import { createSignal, onMount, createEffect, onCleanup, Show, JSX } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { DMSidebar, type Friend, type FriendRequest, type SearchResult } from './DMSidebar';
import { DMChatPanel, type DMMessage } from './DMChatPanel';
import { authStore } from '@/stores/auth';
import { api } from '@/api';
import { socketService } from '@/lib/socket';

// API response types
interface FriendRequestsResponse {
  incoming: Array<{
    id: string;
    user: {
      id: string;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
    };
    created_at: string;
  }>;
  outgoing: Array<{
    id: string;
    user: {
      id: string;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
    };
    created_at: string;
  }>;
}

// Blocked user type
export interface BlockedUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  blocked_at: string;
}

export function DMPage(): JSX.Element {
  const navigate = useNavigate();
  const [friends, setFriends] = createSignal<Friend[]>([]);
  const [selectedFriend, setSelectedFriend] = createSignal<Friend | null>(null);
  const [messages, setMessages] = createSignal<DMMessage[]>([]);
  const [incomingRequests, setIncomingRequests] = createSignal<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = createSignal<FriendRequest[]>([]);
  const [searchResults, setSearchResults] = createSignal<SearchResult[]>([]);
  const [isSearching, setIsSearching] = createSignal(false);
  const [isTyping, setIsTyping] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [blockedUsers, setBlockedUsers] = createSignal<BlockedUser[]>([]);

  const currentUserId = () => authStore.state().user?.id || '';

  const handleBack = () => {
    navigate('/channels/');
  };

  // Fetch friends list from API
  const fetchFriends = async () => {
    try {
      const friendsData = await api.get<Friend[]>('/friends');
      setFriends(friendsData || []);
    } catch (err) {
      console.error('Failed to fetch friends:', err);
      setError('Failed to load friends');
    }
  };

  // Fetch friend requests from API
  const fetchFriendRequests = async () => {
    try {
      const requestsData = await api.get<FriendRequestsResponse>('/friends/requests');
      
      // Transform incoming requests
      const incoming: FriendRequest[] = (requestsData.incoming || []).map(req => ({
        id: req.id,
        user: req.user,
        created_at: req.created_at,
      }));
      
      // Transform outgoing requests
      const outgoing: FriendRequest[] = (requestsData.outgoing || []).map(req => ({
        id: req.id,
        user: req.user,
        created_at: req.created_at,
      }));
      
      setIncomingRequests(incoming);
      setOutgoingRequests(outgoing);
    } catch (err) {
      console.error('Failed to fetch friend requests:', err);
    }
  };

  // Fetch messages for selected friend
  const fetchMessages = async (friendId: string) => {
    try {
      const messagesData = await api.get<DMMessage[]>(`/dms/${friendId}/messages`);
      setMessages(messagesData || []);
    } catch (err) {
      console.error('Failed to fetch messages:', err);
      setMessages([]);
    }
  };

  // Fetch blocked users from API
  const fetchBlockedUsers = async () => {
    try {
      const blockedData = await api.get<BlockedUser[]>('/users/blocked');
      setBlockedUsers(blockedData || []);
    } catch (err) {
      console.error('Failed to fetch blocked users:', err);
      // Don't set error - blocked users is optional, don't block the whole page
    }
  };

  // Load data on mount
  onMount(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      await Promise.all([
        fetchFriends(),
        fetchFriendRequests(),
        fetchBlockedUsers(),
      ]);
    } catch (err) {
      console.error('Failed to load DM data:', err);
      setError('Failed to load data');
    } finally {
      setIsLoading(false);
    }
  });

  // Socket event handlers
  createEffect(() => {
    // Friend request received
    const handleFriendRequest = (data: { request: FriendRequest }) => {
      setIncomingRequests(prev => [...prev, data.request]);
    };

    // Friend request accepted (by someone we sent request to)
    const handleFriendAccept = (data: { friend: Friend }) => {
      setFriends(prev => [...prev, data.friend]);
      setOutgoingRequests(prev => prev.filter(r => r.user.id !== data.friend.id));
    };

    // Friend removed
    const handleFriendRemove = (data: { user_id: string }) => {
      setFriends(prev => prev.filter(f => f.id !== data.user_id));
      // If chatting with removed friend, clear selection
      if (selectedFriend()?.id === data.user_id) {
        setSelectedFriend(null);
        setMessages([]);
      }
    };

    // New DM message received
    const handleDMMessage = (data: { from_user_id: string; message: DMMessage }) => {
      // If we're chatting with this user, add message to conversation
      if (selectedFriend()?.id === data.from_user_id) {
        setMessages(prev => [...prev, data.message]);
      } else {
        // Update unread count for this friend
        setFriends(prev => prev.map(f => 
          f.id === data.from_user_id 
            ? { ...f, unread_count: (f.unread_count || 0) + 1 }
            : f
        ));
      }
    };

    // DM typing indicators
    const handleDMTypingStart = (data: { user_id: string }) => {
      if (selectedFriend()?.id === data.user_id) {
        setIsTyping(true);
      }
    };

    const handleDMTypingStop = (data: { user_id: string }) => {
      if (selectedFriend()?.id === data.user_id) {
        setIsTyping(false);
      }
    };

    // Presence updates for friends
    const handlePresenceUpdate = (data: { user_id: string; status: 'online' | 'idle' | 'dnd' | 'offline' }) => {
      setFriends(prev => prev.map(f => 
        f.id === data.user_id ? { ...f, status: data.status } : f
      ));
    };

    // User blocked us - remove them from friends and clear chat if open
    const handleUserBlock = (data: { user_id: string }) => {
      setFriends(prev => prev.filter(f => f.id !== data.user_id));
      setIncomingRequests(prev => prev.filter(r => r.user.id !== data.user_id));
      setOutgoingRequests(prev => prev.filter(r => r.user.id !== data.user_id));
      if (selectedFriend()?.id === data.user_id) {
        setSelectedFriend(null);
        setMessages([]);
      }
    };

    // Register socket listeners
    socketService.on('friend.request.new', handleFriendRequest);
    socketService.on('friend.request.accepted', handleFriendAccept);
    socketService.on('friend.removed', handleFriendRemove);
    socketService.on('dm.message.new', handleDMMessage);
    socketService.on('dm.typing.start', handleDMTypingStart);
    socketService.on('dm.typing.stop', handleDMTypingStop);
    socketService.on('presence.update', handlePresenceUpdate);
    socketService.on('user.block', handleUserBlock);

    onCleanup(() => {
      socketService.off('friend.request.new', handleFriendRequest);
      socketService.off('friend.request.accepted', handleFriendAccept);
      socketService.off('friend.removed', handleFriendRemove);
      socketService.off('dm.message.new', handleDMMessage);
      socketService.off('dm.typing.start', handleDMTypingStart);
      socketService.off('dm.typing.stop', handleDMTypingStop);
      socketService.off('presence.update', handlePresenceUpdate);
      socketService.off('user.block', handleUserBlock);
    });
  });

  const handleSelectFriend = async (friend: Friend) => {
    setSelectedFriend(friend);
    setIsTyping(false);
    
    // Fetch messages for this friend
    await fetchMessages(friend.id);
    
    // Clear unread count
    setFriends(prev => prev.map(f => 
      f.id === friend.id ? { ...f, unread_count: 0 } : f
    ));
  };

  const handleSearch = async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    
    setIsSearching(true);
    try {
      const results = await api.get<SearchResult[]>(`/users/search?q=${encodeURIComponent(query)}`);
      // Filter out current user to prevent self-add
      const filteredResults = (results || []).filter(u => u.id !== currentUserId());
      setSearchResults(filteredResults);
    } catch (err) {
      console.error('Failed to search users:', err);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddFriend = async (userId: string) => {
    try {
      // Send empty object as body - server requires body when Content-Type is application/json
      const response = await api.post<{ message: string; request: { id: string; user: any; created_at: string } }>(`/friends/${userId}`, {});
      
      // Add to outgoing requests
      setOutgoingRequests(prev => [...prev, {
        id: response.request.id,
        user: response.request.user,
        created_at: response.request.created_at,
      }]);
      
      // Update search results to show pending
      setSearchResults(prev => prev.map(u => 
        u.id === userId ? { ...u, request_pending: true, request_direction: 'outgoing' as const } : u
      ));
    } catch (err) {
      console.error('Failed to send friend request:', err);
    }
  };

  const handleCancelRequest = async (userId: string) => {
    try {
      await api.delete(`/friends/${userId}`);
      
      setOutgoingRequests(prev => prev.filter(r => r.user.id !== userId));
      setSearchResults(prev => prev.map(u => 
        u.id === userId ? { ...u, request_pending: false, request_direction: null } : u
      ));
    } catch (err) {
      console.error('Failed to cancel friend request:', err);
    }
  };

  const handleAcceptRequest = async (userId: string) => {
    try {
      const response = await api.post<{ message: string; friend: Friend }>(`/friends/requests/${userId}/accept`);
      
      // Add to friends list
      setFriends(prev => [...prev, response.friend]);
      
      // Remove from incoming requests
      setIncomingRequests(prev => prev.filter(r => r.user.id !== userId));
    } catch (err) {
      console.error('Failed to accept friend request:', err);
    }
  };

  const handleRejectRequest = async (userId: string) => {
    try {
      await api.post(`/friends/requests/${userId}/reject`);
      
      setIncomingRequests(prev => prev.filter(r => r.user.id !== userId));
    } catch (err) {
      console.error('Failed to reject friend request:', err);
    }
  };

  const handleBlockUser = async (userId: string) => {
    try {
      const response = await api.post<{ message: string; blocked_user: BlockedUser }>(`/users/${userId}/block`);
      
      // Add to blocked users list
      setBlockedUsers(prev => [...prev, response.blocked_user]);
      
      // Remove from friends if they were a friend
      setFriends(prev => prev.filter(f => f.id !== userId));
      
      // Remove any pending requests
      setIncomingRequests(prev => prev.filter(r => r.user.id !== userId));
      setOutgoingRequests(prev => prev.filter(r => r.user.id !== userId));
      
      // Update search results to show blocked
      setSearchResults(prev => prev.map(u => 
        u.id === userId ? { ...u, is_blocked: true } : u
      ));
      
      // If chatting with blocked user, clear selection
      if (selectedFriend()?.id === userId) {
        setSelectedFriend(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to block user:', err);
    }
  };

  const handleUnblockUser = async (userId: string) => {
    try {
      await api.delete(`/users/${userId}/block`);
      
      // Remove from blocked list
      setBlockedUsers(prev => prev.filter(u => u.id !== userId));
      
      // Update search results to show unblocked
      setSearchResults(prev => prev.map(u => 
        u.id === userId ? { ...u, is_blocked: false } : u
      ));
    } catch (err) {
      console.error('Failed to unblock user:', err);
    }
  };

  const handleSendMessage = async (content: string) => {
    const friend = selectedFriend();
    if (!friend || !content.trim()) return;

    try {
      const newMessage = await api.post<DMMessage>(`/dms/${friend.id}/messages`, { content });
      setMessages(prev => [...prev, newMessage]);
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  const handleTypingStart = () => {
    const friend = selectedFriend();
    if (!friend) return;
    socketService.emit('dm:typing:start', { user_id: friend.id });
  };

  const handleTypingStop = () => {
    const friend = selectedFriend();
    if (!friend) return;
    socketService.emit('dm:typing:stop', { user_id: friend.id });
  };

  const pendingRequestCount = () => incomingRequests().length;

  // Loading UI component
  const LoadingUI = () => (
    <div class="flex h-full w-full bg-bg-primary items-center justify-center">
      <div class="flex flex-col items-center gap-4">
        <div class="w-10 h-10 border-4 border-brand-primary border-t-transparent rounded-full animate-spin" />
        <p class="text-text-muted">Loading...</p>
      </div>
    </div>
  );

  // Error UI component
  const ErrorUI = () => (
    <div class="flex h-full w-full bg-bg-primary items-center justify-center">
      <div class="flex flex-col items-center gap-4 text-center p-8">
        <div class="w-16 h-16 bg-danger/20 rounded-full flex items-center justify-center">
          <svg class="w-8 h-8 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div>
          <h3 class="text-lg font-semibold text-text-primary mb-1">Failed to Load</h3>
          <p class="text-text-muted text-sm mb-4">{error()}</p>
          <p class="text-text-muted text-xs mb-4">
            The server may not have the friend system implemented yet.
          </p>
        </div>
        <div class="flex gap-3">
          <button
            onClick={handleBack}
            class="px-4 py-2 bg-bg-tertiary hover:bg-bg-modifier-hover text-text-primary rounded-lg transition-colors"
          >
            Back to Server
          </button>
          <button
            onClick={async () => {
              setError(null);
              setIsLoading(true);
              try {
                await Promise.all([fetchFriends(), fetchFriendRequests(), fetchBlockedUsers()]);
              } catch (e) {
                setError('Failed to load data');
              } finally {
                setIsLoading(false);
              }
            }}
            class="px-4 py-2 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  );

  // Use Show components for reactive conditional rendering
  return (
    <Show when={!isLoading()} fallback={<LoadingUI />}>
      <Show when={!error()} fallback={<ErrorUI />}>
        <div class="flex h-full w-full bg-bg-primary">
          <DMSidebar
            friends={friends()}
            selectedFriendId={selectedFriend()?.id || null}
            onSelectFriend={handleSelectFriend}
            pendingRequestCount={pendingRequestCount()}
            incomingRequests={incomingRequests()}
            outgoingRequests={outgoingRequests()}
            onSearch={handleSearch}
            searchResults={searchResults()}
            onAddFriend={handleAddFriend}
            onCancelRequest={handleCancelRequest}
            onAcceptRequest={handleAcceptRequest}
            onRejectRequest={handleRejectRequest}
            isSearching={isSearching()}
            onBack={handleBack}
            blockedUsers={blockedUsers()}
            onBlockUser={handleBlockUser}
            onUnblockUser={handleUnblockUser}
          />
          <DMChatPanel
            friend={selectedFriend()}
            messages={messages()}
            currentUserId={currentUserId()}
            onSendMessage={handleSendMessage}
            onTypingStart={handleTypingStart}
            onTypingStop={handleTypingStop}
            isTyping={isTyping()}
          />
        </div>
      </Show>
    </Show>
  );
}
