import { useState, useMemo } from 'react';
import { Avatar } from '@/components/ui/Avatar';

export interface Friend {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  status: 'online' | 'idle' | 'dnd' | 'offline';
  since?: string;
  unread_count?: number;
  custom_status?: string | null;
  timezone?: string | null;
  timezone_public?: boolean;
  timezone_dst_enabled?: boolean;
  dm_channel_id?: string | null;
}

export interface FriendRequest {
  id: string;
  user: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  };
  created_at: string;
}

export interface SearchResult {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_friend: boolean;
  request_pending: boolean;
  request_direction: 'incoming' | 'outgoing' | null;
  is_blocked?: boolean;
}

export interface BlockedUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  blocked_at: string;
}

interface DMSidebarProps {
  friends: Friend[];
  selectedFriendId: string | null;
  onSelectFriend: (friend: Friend) => void;
  pendingRequestCount: number;
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
  onSearch: (query: string) => void;
  searchResults: SearchResult[];
  onAddFriend: (userId: string) => void;
  onCancelRequest: (userId: string) => void;
  onAcceptRequest: (userId: string) => void;
  onRejectRequest: (userId: string) => void;
  isSearching?: boolean;
  onBack: () => void;
  blockedUsers: BlockedUser[];
  onBlockUser: (userId: string) => void;
  onUnblockUser: (userId: string) => void;
}

export function DMSidebar({
  friends,
  selectedFriendId,
  onSelectFriend,
  pendingRequestCount,
  incomingRequests,
  outgoingRequests,
  onSearch,
  searchResults,
  onAddFriend,
  onCancelRequest,
  onAcceptRequest,
  onRejectRequest,
  isSearching,
  onBack,
  blockedUsers,
  onBlockUser,
  onUnblockUser,
}: DMSidebarProps) {
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const onlineFriends = useMemo(() => friends.filter(f => f.status !== 'offline'), [friends]);
  const offlineFriends = useMemo(() => friends.filter(f => f.status === 'offline'), [friends]);

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (value.length >= 2) {
      onSearch(value);
    }
  };

  const handleFindClick = () => {
    if (isSearchMode) {
      setIsSearchMode(false);
      setSearchQuery('');
    } else {
      setIsSearchMode(true);
    }
  };

  const exitSearchMode = () => {
    setIsSearchMode(false);
    setSearchQuery('');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-status-online';
      case 'idle': return 'bg-status-idle';
      case 'dnd': return 'bg-status-dnd';
      default: return 'bg-status-offline';
    }
  };

  return (
    <div className="w-60 bg-bg-secondary flex flex-col h-full border-r border-bg-tertiary">
      {/* Back Button */}
      <div className="p-3 border-b border-bg-tertiary">
        <button
          onClick={onBack}
          className="w-full flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-tertiary hover:bg-bg-modifier-hover text-text-primary transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span className="font-medium">Back to Server</span>
        </button>
      </div>

      {/* Find Button */}
      <div className="p-3 border-b border-bg-tertiary">
        <button
          onClick={handleFindClick}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors ${
            isSearchMode
              ? 'bg-brand-primary text-white'
              : 'bg-bg-tertiary hover:bg-bg-modifier-hover text-text-primary'
          }`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="font-medium">Find</span>
          {pendingRequestCount > 0 && !isSearchMode && (
            <span className="ml-auto bg-danger text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {pendingRequestCount > 9 ? '9+' : pendingRequestCount}
            </span>
          )}
        </button>
      </div>

      {/* Search Mode Content */}
      {isSearchMode && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Search Input */}
          <div className="p-3 border-b border-bg-tertiary">
            <div className="relative">
              <input
                type="text"
                placeholder="Search username..."
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && exitSearchMode()}
                className="w-full px-3 py-2 bg-bg-tertiary rounded-lg text-text-primary placeholder:text-text-muted outline-none focus:ring-2 focus:ring-brand-primary"
                autoFocus
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {/* Incoming Requests */}
            {incomingRequests.length > 0 && (
              <div className="p-2">
                <div className="text-xs font-semibold text-text-muted uppercase px-2 py-1">
                  Friend Requests — {incomingRequests.length}
                </div>
                {incomingRequests.map((request) => (
                  <div key={request.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-bg-modifier-hover">
                    <Avatar
                      src={request.user.avatar_url}
                      alt={request.user.display_name || request.user.username}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-primary truncate">
                        {request.user.display_name || request.user.username}
                      </div>
                      <div className="text-xs text-text-muted">@{request.user.username}</div>
                    </div>
                    <button
                      onClick={() => onAcceptRequest(request.user.id)}
                      className="p-1.5 rounded bg-status-online/20 text-status-online hover:bg-status-online/30"
                      title="Accept"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                    <button
                      onClick={() => onRejectRequest(request.user.id)}
                      className="p-1.5 rounded bg-danger/20 text-danger hover:bg-danger/30"
                      title="Reject"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Search Results */}
            {searchQuery.length >= 2 && (
              <div className="p-2">
                <div className="text-xs font-semibold text-text-muted uppercase px-2 py-1">
                  Search Results
                </div>
                {isSearching && (
                  <div className="flex items-center justify-center py-4">
                    <div className="w-5 h-5 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {!isSearching && searchResults.length === 0 && (
                  <div className="text-center py-4 text-text-muted text-sm">
                    No users found
                  </div>
                )}
                {searchResults.map((user) => (
                  <div key={user.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-bg-modifier-hover">
                    <Avatar
                      src={user.avatar_url}
                      alt={user.display_name || user.username}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-primary truncate">
                        {user.display_name || user.username}
                      </div>
                      <div className="text-xs text-text-muted">@{user.username}</div>
                    </div>
                    {user.is_blocked ? (
                      <button
                        onClick={() => onUnblockUser(user.id)}
                        className="px-3 py-1 text-xs font-medium bg-danger/20 text-danger rounded hover:bg-danger hover:text-white"
                      >
                        Blocked
                      </button>
                    ) : (
                      <>
                        {user.is_friend && (
                          <span className="text-xs text-status-online font-medium">Friends</span>
                        )}
                        {!user.is_friend && !user.request_pending && (
                          <>
                            <button
                              onClick={() => onAddFriend(user.id)}
                              className="px-3 py-1 text-xs font-medium bg-brand-primary text-white rounded hover:bg-brand-primary/80"
                            >
                              Add
                            </button>
                            <button
                              onClick={() => onBlockUser(user.id)}
                              className="p-1.5 rounded text-text-muted hover:bg-danger/20 hover:text-danger"
                              title="Block user"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                              </svg>
                            </button>
                          </>
                        )}
                        {user.request_pending && user.request_direction === 'outgoing' && (
                          <button
                            onClick={() => onCancelRequest(user.id)}
                            className="px-3 py-1 text-xs font-medium bg-bg-tertiary text-text-muted rounded hover:bg-danger hover:text-white"
                          >
                            Pending
                          </button>
                        )}
                        {user.request_pending && user.request_direction === 'incoming' && (
                          <button
                            onClick={() => onAcceptRequest(user.id)}
                            className="px-3 py-1 text-xs font-medium bg-status-online text-white rounded hover:bg-status-online/80"
                          >
                            Accept
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Outgoing Requests */}
            {outgoingRequests.length > 0 && searchQuery.length < 2 && (
              <div className="p-2">
                <div className="text-xs font-semibold text-text-muted uppercase px-2 py-1">
                  Pending — {outgoingRequests.length}
                </div>
                {outgoingRequests.map((request) => (
                  <div key={request.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-bg-modifier-hover">
                    <Avatar
                      src={request.user.avatar_url}
                      alt={request.user.display_name || request.user.username}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-primary truncate">
                        {request.user.display_name || request.user.username}
                      </div>
                      <div className="text-xs text-text-muted">@{request.user.username}</div>
                    </div>
                    <button
                      onClick={() => onCancelRequest(request.user.id)}
                      className="px-3 py-1 text-xs font-medium bg-bg-tertiary text-text-muted rounded hover:bg-danger hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Blocked Users */}
            {blockedUsers.length > 0 && searchQuery.length < 2 && (
              <div className="p-2 border-t border-bg-tertiary">
                <div className="text-xs font-semibold text-text-muted uppercase px-2 py-1">
                  Blocked — {blockedUsers.length}
                </div>
                {blockedUsers.map((user) => (
                  <div key={user.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-bg-modifier-hover opacity-60">
                    <Avatar
                      src={user.avatar_url}
                      alt={user.display_name || user.username}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-primary truncate">
                        {user.display_name || user.username}
                      </div>
                      <div className="text-xs text-text-muted">@{user.username}</div>
                    </div>
                    <button
                      onClick={() => onUnblockUser(user.id)}
                      className="px-3 py-1 text-xs font-medium bg-bg-tertiary text-text-muted rounded hover:bg-status-online hover:text-white"
                    >
                      Unblock
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Normal Friend List Mode */}
      {!isSearchMode && (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {/* Friends Section */}
          <div className="p-2">
            <div className="text-xs font-semibold text-text-muted uppercase px-2 py-1">
              Friends — {onlineFriends.length}
            </div>
            {onlineFriends.map((friend) => (
              <button
                key={friend.id}
                onClick={() => onSelectFriend(friend)}
                className={`w-full flex items-center gap-2 p-2 rounded-lg transition-colors ${
                  selectedFriendId === friend.id
                    ? 'bg-bg-modifier-selected'
                    : 'hover:bg-bg-modifier-hover'
                }`}
              >
                <div className="relative flex-shrink-0">
                  <Avatar
                    src={friend.avatar_url}
                    alt={friend.display_name || friend.username}
                    size="sm"
                  />
                  <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-bg-secondary ${getStatusColor(friend.status)}`} />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-sm font-medium text-text-primary truncate">
                    {friend.display_name || friend.username}
                  </div>
                  {friend.custom_status && (
                    <div className="text-xs text-text-muted truncate">
                      {friend.custom_status}
                    </div>
                  )}
                </div>
                {(friend.unread_count ?? 0) > 0 && (
                  <span className="bg-danger text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    {(friend.unread_count ?? 0) > 9 ? '9+' : friend.unread_count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Offline Section */}
          {offlineFriends.length > 0 && (
            <div className="p-2 border-t border-bg-tertiary">
              <div className="text-xs font-semibold text-text-muted uppercase px-2 py-1">
                Offline — {offlineFriends.length}
              </div>
              {offlineFriends.map((friend) => (
                <button
                  key={friend.id}
                  onClick={() => onSelectFriend(friend)}
                  className={`w-full flex items-center gap-2 p-2 rounded-lg transition-colors opacity-60 ${
                    selectedFriendId === friend.id
                      ? 'bg-bg-modifier-selected opacity-100'
                      : 'hover:bg-bg-modifier-hover hover:opacity-100'
                  }`}
                >
                  <div className="relative flex-shrink-0">
                    <Avatar
                      src={friend.avatar_url}
                      alt={friend.display_name || friend.username}
                      size="sm"
                    />
                    <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-bg-secondary ${getStatusColor(friend.status)}`} />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-sm font-medium text-text-primary truncate">
                      {friend.display_name || friend.username}
                    </div>
                    {friend.custom_status && (
                      <div className="text-xs text-text-muted truncate">
                        {friend.custom_status}
                      </div>
                    )}
                  </div>
                  {(friend.unread_count ?? 0) > 0 && (
                    <span className="bg-danger text-white text-xs font-bold px-2 py-0.5 rounded-full">
                      {(friend.unread_count ?? 0) > 9 ? '9+' : friend.unread_count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Empty State */}
          {friends.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full p-4 text-center">
              <div className="w-16 h-16 bg-bg-tertiary rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <p className="text-text-muted text-sm mb-2">No friends yet</p>
              <p className="text-text-muted text-xs">Click Find to search for friends</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
