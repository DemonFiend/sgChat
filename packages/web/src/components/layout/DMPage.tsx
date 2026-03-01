import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { DMSidebar, type Friend, type FriendRequest, type SearchResult } from './DMSidebar';
import { DMChatPanel, type DMMessage } from './DMChatPanel';
import { authStore } from '@/stores/auth';
import { api } from '@/api';
import { socketService } from '@/lib/socket';
import { soundService } from '@/lib/soundService';

// API response types
interface FriendRequestsResponse {
  incoming: Array<{
    id: string;
    from_user: {
      id: string;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
    };
    created_at: string;
  }>;
  outgoing: Array<{
    id: string;
    to_user: {
      id: string;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
    };
    created_at: string;
  }>;
}

export interface BlockedUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  blocked_at: string;
}

export function DMPage() {
  const navigate = useNavigate();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);

  const currentUserId = authStore.getState().user?.id || '';

  const handleBack = () => {
    navigate('/channels/');
  };

  const fetchFriends = useCallback(async () => {
    try {
      const friendsData = await api.get<Friend[]>('/friends');
      setFriends(friendsData || []);
    } catch (err) {
      console.error('Failed to fetch friends:', err);
      setError('Failed to load friends');
    }
  }, []);

  const fetchFriendRequests = useCallback(async () => {
    try {
      const requestsData = await api.get<FriendRequestsResponse>('/friends/requests');
      const incoming: FriendRequest[] = (requestsData.incoming || []).map(req => ({
        id: req.id,
        user: req.from_user,
        created_at: req.created_at,
      }));
      const outgoing: FriendRequest[] = (requestsData.outgoing || []).map(req => ({
        id: req.id,
        user: req.to_user,
        created_at: req.created_at,
      }));
      setIncomingRequests(incoming);
      setOutgoingRequests(outgoing);
    } catch (err) {
      console.error('Failed to fetch friend requests:', err);
    }
  }, []);

  const fetchMessages = useCallback(async (friendId: string) => {
    try {
      const messagesData = await api.get<DMMessage[]>(`/dms/user/${friendId}/messages`);
      setMessages(messagesData || []);
    } catch (err) {
      console.error('Failed to fetch messages:', err);
      setMessages([]);
    }
  }, []);

  const fetchBlockedUsers = useCallback(async () => {
    try {
      const blockedData = await api.get<BlockedUser[]>('/users/blocked');
      setBlockedUsers(blockedData || []);
    } catch (err) {
      console.error('Failed to fetch blocked users:', err);
    }
  }, []);

  // Load data on mount
  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      setError(null);
      try {
        await Promise.all([fetchFriends(), fetchFriendRequests(), fetchBlockedUsers()]);
      } catch (err) {
        console.error('Failed to load DM data:', err);
        setError('Failed to load data');
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, [fetchFriends, fetchFriendRequests, fetchBlockedUsers]);

  // Socket event handlers
  useEffect(() => {
    const handleFriendRequest = (data: { request: { id: string; from_user: { id: string; username: string; avatar_url: string | null }; created_at: string } }) => {
      const normalizedRequest: FriendRequest = {
        id: data.request.id,
        user: {
          id: data.request.from_user.id,
          username: data.request.from_user.username,
          display_name: data.request.from_user.username,
          avatar_url: data.request.from_user.avatar_url,
        },
        created_at: data.request.created_at,
      };
      setIncomingRequests(prev => [...prev, normalizedRequest]);
    };

    const handleFriendAccept = (data: { friend: Friend }) => {
      setFriends(prev => [...prev, data.friend]);
      setOutgoingRequests(prev => prev.filter(r => r.user.id !== data.friend.id));
    };

    const handleFriendRemove = (data: { user_id: string }) => {
      setFriends(prev => prev.filter(f => f.id !== data.user_id));
      setSelectedFriend(prev => prev?.id === data.user_id ? null : prev);
      if (selectedFriend?.id === data.user_id) {
        setMessages([]);
      }
    };

    const handleDMMessage = (data: { from_user_id: string; message: DMMessage }) => {
      if (selectedFriend?.id === data.from_user_id) {
        setMessages(prev => {
          if (prev.some(m => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
      } else {
        setFriends(prev => prev.map(f =>
          f.id === data.from_user_id
            ? { ...f, unread_count: (f.unread_count || 0) + 1 }
            : f
        ));
        soundService.playNotification();
      }
    };

    const handleDMMessageUpdate = (data: { id: string; content?: string; edited_at?: string; status?: string }) => {
      setMessages(prev => prev.map(msg =>
        msg.id === data.id ? { ...msg, ...data } : msg
      ));
    };

    const handleDMMessageDelete = (data: { id: string }) => {
      setMessages(prev => prev.filter(msg => msg.id !== data.id));
    };

    const handleDMTypingStart = (data: { user_id: string }) => {
      if (selectedFriend?.id === data.user_id) {
        setIsTyping(true);
      }
    };

    const handleDMTypingStop = (data: { user_id: string }) => {
      if (selectedFriend?.id === data.user_id) {
        setIsTyping(false);
      }
    };

    const handlePresenceUpdate = (data: {
      user_id: string;
      status: 'online' | 'idle' | 'dnd' | 'offline';
      avatar_url?: string | null;
    }) => {
      setFriends(prev => prev.map(f => {
        if (f.id !== data.user_id) return f;
        return {
          ...f,
          status: data.status,
          avatar_url: data.avatar_url !== undefined ? data.avatar_url : f.avatar_url,
        };
      }));
      setSelectedFriend(prev => {
        if (prev?.id !== data.user_id) return prev;
        return {
          ...prev,
          status: data.status,
          avatar_url: data.avatar_url !== undefined ? data.avatar_url : prev.avatar_url,
        };
      });
    };

    const handleUserBlock = (data: { user_id: string }) => {
      setFriends(prev => prev.filter(f => f.id !== data.user_id));
      setIncomingRequests(prev => prev.filter(r => r.user.id !== data.user_id));
      setOutgoingRequests(prev => prev.filter(r => r.user.id !== data.user_id));
      setSelectedFriend(prev => {
        if (prev?.id === data.user_id) {
          setMessages([]);
          return null;
        }
        return prev;
      });
    };

    socketService.on('friend.request.new', handleFriendRequest as (data: unknown) => void);
    socketService.on('friend.request.accepted', handleFriendAccept as (data: unknown) => void);
    socketService.on('friend.removed', handleFriendRemove as (data: unknown) => void);
    socketService.on('dm.message.new', handleDMMessage as (data: unknown) => void);
    socketService.on('dm.message.update', handleDMMessageUpdate as (data: unknown) => void);
    socketService.on('dm.message.delete', handleDMMessageDelete as (data: unknown) => void);
    socketService.on('dm.typing.start', handleDMTypingStart as (data: unknown) => void);
    socketService.on('dm.typing.stop', handleDMTypingStop as (data: unknown) => void);
    socketService.on('presence.update', handlePresenceUpdate as (data: unknown) => void);
    socketService.on('user.block', handleUserBlock as (data: unknown) => void);

    return () => {
      socketService.off('friend.request.new', handleFriendRequest as (data: unknown) => void);
      socketService.off('friend.request.accepted', handleFriendAccept as (data: unknown) => void);
      socketService.off('friend.removed', handleFriendRemove as (data: unknown) => void);
      socketService.off('dm.message.new', handleDMMessage as (data: unknown) => void);
      socketService.off('dm.message.update', handleDMMessageUpdate as (data: unknown) => void);
      socketService.off('dm.message.delete', handleDMMessageDelete as (data: unknown) => void);
      socketService.off('dm.typing.start', handleDMTypingStart as (data: unknown) => void);
      socketService.off('dm.typing.stop', handleDMTypingStop as (data: unknown) => void);
      socketService.off('presence.update', handlePresenceUpdate as (data: unknown) => void);
      socketService.off('user.block', handleUserBlock as (data: unknown) => void);
    };
  }, [selectedFriend?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectFriend = useCallback(async (friend: Friend) => {
    setSelectedFriend(friend);
    setIsTyping(false);
    await fetchMessages(friend.id);
    setFriends(prev => prev.map(f =>
      f.id === friend.id ? { ...f, unread_count: 0 } : f
    ));
  }, [fetchMessages]);

  const handleSearch = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const results = await api.get<SearchResult[]>(`/users/search?q=${encodeURIComponent(query)}`);
      const filteredResults = (results || []).filter(u => u.id !== currentUserId);
      setSearchResults(filteredResults);
    } catch (err) {
      console.error('Failed to search users:', err);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [currentUserId]);

  const handleAddFriend = useCallback(async (userId: string) => {
    try {
      const response = await api.post<{ message: string; request: { id: string; to_user: { id: string; username: string; display_name: string; avatar_url: string | null }; created_at: string } }>(`/friends/${userId}`, {});
      setOutgoingRequests(prev => [...prev, {
        id: response.request.id,
        user: response.request.to_user,
        created_at: response.request.created_at,
      }]);
      setSearchResults(prev => prev.map(u =>
        u.id === userId ? { ...u, request_pending: true, request_direction: 'outgoing' as const } : u
      ));
    } catch (err) {
      console.error('Failed to send friend request:', err);
    }
  }, []);

  const handleCancelRequest = useCallback(async (userId: string) => {
    try {
      await api.delete(`/friends/${userId}`);
      setOutgoingRequests(prev => prev.filter(r => r.user.id !== userId));
      setSearchResults(prev => prev.map(u =>
        u.id === userId ? { ...u, request_pending: false, request_direction: null } : u
      ));
    } catch (err) {
      console.error('Failed to cancel friend request:', err);
    }
  }, []);

  const handleAcceptRequest = useCallback(async (userId: string) => {
    try {
      const response = await api.post<{ message: string; friend: Friend }>(`/friends/requests/${userId}/accept`, {});
      setFriends(prev => [...prev, response.friend]);
      setIncomingRequests(prev => prev.filter(r => r.user.id !== userId));
    } catch (err) {
      console.error('Failed to accept friend request:', err);
    }
  }, []);

  const handleRejectRequest = useCallback(async (userId: string) => {
    try {
      await api.post(`/friends/requests/${userId}/reject`, {});
      setIncomingRequests(prev => prev.filter(r => r.user.id !== userId));
    } catch (err) {
      console.error('Failed to reject friend request:', err);
    }
  }, []);

  const handleBlockUser = useCallback(async (userId: string) => {
    try {
      const response = await api.post<{ message: string; blocked_user: BlockedUser }>(`/users/${userId}/block`);
      setBlockedUsers(prev => [...prev, response.blocked_user]);
      setFriends(prev => prev.filter(f => f.id !== userId));
      setIncomingRequests(prev => prev.filter(r => r.user.id !== userId));
      setOutgoingRequests(prev => prev.filter(r => r.user.id !== userId));
      setSearchResults(prev => prev.map(u =>
        u.id === userId ? { ...u, is_blocked: true } : u
      ));
      if (selectedFriend?.id === userId) {
        setSelectedFriend(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to block user:', err);
    }
  }, [selectedFriend?.id]);

  const handleUnblockUser = useCallback(async (userId: string) => {
    try {
      await api.delete(`/users/${userId}/block`);
      setBlockedUsers(prev => prev.filter(u => u.id !== userId));
      setSearchResults(prev => prev.map(u =>
        u.id === userId ? { ...u, is_blocked: false } : u
      ));
    } catch (err) {
      console.error('Failed to unblock user:', err);
    }
  }, []);

  const handleSendMessage = useCallback(async (content: string) => {
    if (!selectedFriend || !content.trim()) return;
    try {
      const newMessage = await api.post<DMMessage>(`/dms/user/${selectedFriend.id}/messages`, { content });
      setMessages(prev => [...prev, newMessage]);
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  }, [selectedFriend]);

  const handleTypingStart = useCallback(() => {
    if (!selectedFriend) return;
    socketService.emit('dm.typing.start', { user_id: selectedFriend.id });
  }, [selectedFriend]);

  const handleTypingStop = useCallback(() => {
    if (!selectedFriend) return;
    socketService.emit('dm.typing.stop', { user_id: selectedFriend.id });
  }, [selectedFriend]);

  if (isLoading) {
    return (
      <div className="flex h-full w-full bg-bg-primary items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-brand-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-text-muted">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full bg-bg-primary items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center p-8">
          <div className="w-16 h-16 bg-danger/20 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary mb-1">Failed to Load</h3>
            <p className="text-text-muted text-sm mb-4">{error}</p>
            <p className="text-text-muted text-xs mb-4">
              The server may not have the friend system implemented yet.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleBack}
              className="px-4 py-2 bg-bg-tertiary hover:bg-bg-modifier-hover text-text-primary rounded-lg transition-colors"
            >
              Back to Server
            </button>
            <button
              onClick={async () => {
                setError(null);
                setIsLoading(true);
                try {
                  await Promise.all([fetchFriends(), fetchFriendRequests(), fetchBlockedUsers()]);
                } catch {
                  setError('Failed to load data');
                } finally {
                  setIsLoading(false);
                }
              }}
              className="px-4 py-2 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-lg transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-bg-primary">
      <DMSidebar
        friends={friends}
        selectedFriendId={selectedFriend?.id || null}
        onSelectFriend={handleSelectFriend}
        pendingRequestCount={incomingRequests.length}
        incomingRequests={incomingRequests}
        outgoingRequests={outgoingRequests}
        onSearch={handleSearch}
        searchResults={searchResults}
        onAddFriend={handleAddFriend}
        onCancelRequest={handleCancelRequest}
        onAcceptRequest={handleAcceptRequest}
        onRejectRequest={handleRejectRequest}
        isSearching={isSearching}
        onBack={handleBack}
        blockedUsers={blockedUsers}
        onBlockUser={handleBlockUser}
        onUnblockUser={handleUnblockUser}
      />
      <DMChatPanel
        friend={selectedFriend}
        messages={messages}
        currentUserId={currentUserId}
        currentUserAvatar={authStore.getState().user?.avatar_url}
        currentUserDisplayName={authStore.getState().user?.display_name || authStore.getState().user?.username}
        onSendMessage={handleSendMessage}
        onTypingStart={handleTypingStart}
        onTypingStop={handleTypingStop}
        isTyping={isTyping}
      />
    </div>
  );
}
