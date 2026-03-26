import { useState, useMemo, useEffect } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { api } from '@/api';
import { authStore } from '@/stores/auth';

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

export interface IgnoredUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  ignored_at: string;
}

interface AuditLogEntry {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  changes: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
  actor_username: string;
}

type SidebarTab = 'all' | 'online' | 'friends' | 'pending' | 'blocked' | 'ignored' | 'history';

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
  ignoredUsers: IgnoredUser[];
  onIgnoreUser: (userId: string) => void;
  onUnignoreUser: (userId: string) => void;
  incomingCallFromId?: string | null;
}

const TABS: { id: SidebarTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'online', label: 'Online' },
  { id: 'friends', label: 'Friends' },
  { id: 'pending', label: 'Pending' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'ignored', label: 'Ignored' },
  { id: 'history', label: 'History' },
];

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
  ignoredUsers,
  onIgnoreUser,
  onUnignoreUser,
  incomingCallFromId,
}: DMSidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const onlineFriends = useMemo(() => friends.filter(f => f.status !== 'offline'), [friends]);
  const offlineFriends = useMemo(() => friends.filter(f => f.status === 'offline'), [friends]);

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (value.length >= 2) {
      onSearch(value);
    }
  };

  // Fetch audit log when history tab is selected (only actions against current user)
  useEffect(() => {
    if (activeTab === 'history' && auditLog.length === 0) {
      const currentUserId = authStore.getState().user?.id;
      if (!currentUserId) return;
      setAuditLoading(true);
      const actions = 'member_warn,member_timeout,member_kick,member_ban';
      api.get<{ id: string }>('/server').then(server => {
        return api.get<AuditLogEntry[]>(
          `/servers/${server.id}/audit-log?limit=50&target_id=${currentUserId}&target_type=member&actions=${actions}`,
        );
      }).then(entries => {
        setAuditLog(entries || []);
      }).catch(err => {
        console.error('Failed to fetch audit log:', err);
      }).finally(() => {
        setAuditLoading(false);
      });
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-status-online';
      case 'idle': return 'bg-status-idle';
      case 'dnd': return 'bg-status-dnd';
      default: return 'bg-status-offline';
    }
  };

  const formatAuditAction = (action: string) => {
    return action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const renderFriendItem = (friend: Friend, isOffline = false) => (
    <button
      key={friend.id}
      onClick={() => onSelectFriend(friend)}
      className={`w-full flex items-center gap-2 p-2 rounded-lg transition-colors ${
        isOffline ? 'opacity-60' : ''
      } ${
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
      {friend.id === incomingCallFromId && (
        <div className="flex-shrink-0 animate-pulse" title="Incoming call">
          <svg className="w-4 h-4 text-status-online" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
        </div>
      )}
      {(friend.unread_count ?? 0) > 0 && (
        <span className="bg-danger text-white text-xs font-bold px-2 py-0.5 rounded-full">
          {(friend.unread_count ?? 0) > 9 ? '9+' : friend.unread_count}
        </span>
      )}
    </button>
  );

  return (
    <div className="w-full md:w-60 bg-bg-secondary flex flex-col h-full border-r border-bg-tertiary">
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

      {/* Tabs */}
      <div className="border-b border-bg-tertiary">
        <div className="flex flex-wrap px-2 py-1.5 gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                activeTab === tab.id
                  ? 'bg-brand-primary text-white'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover'
              }`}
            >
              {tab.label}
              {tab.id === 'pending' && pendingRequestCount > 0 && (
                <span className="ml-1 bg-danger text-white text-[10px] font-bold px-1.5 py-0 rounded-full">
                  {pendingRequestCount > 9 ? '9+' : pendingRequestCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* ALL Tab — Search + All Friends */}
        {activeTab === 'all' && (
          <div className="flex flex-col h-full">
            {/* Search Input */}
            <div className="p-2">
              <div className="relative">
                <input
                  type="text"
                  name="search-dm-users"
                  placeholder="Search users..."
                  value={searchQuery}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-tertiary rounded-lg text-text-primary placeholder:text-text-muted outline-none focus:ring-2 focus:ring-brand-primary text-sm"
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
                  <div className="text-center py-4 text-text-muted text-sm">No users found</div>
                )}
                {searchResults.map((user) => (
                  <div key={user.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-bg-modifier-hover">
                    <Avatar src={user.avatar_url} alt={user.display_name || user.username} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-primary truncate">{user.display_name || user.username}</div>
                      <div className="text-xs text-text-muted">@{user.username}</div>
                    </div>
                    {user.is_blocked ? (
                      <button onClick={() => onUnblockUser(user.id)} className="px-3 py-1 text-xs font-medium bg-danger/20 text-danger rounded hover:bg-danger hover:text-white">Blocked</button>
                    ) : (
                      <>
                        {user.is_friend && <span className="text-xs text-status-online font-medium">Friends</span>}
                        {!user.is_friend && !user.request_pending && (
                          <>
                            <button onClick={() => onAddFriend(user.id)} className="px-3 py-1 text-xs font-medium bg-brand-primary text-white rounded hover:bg-brand-primary/80">Add</button>
                            <button onClick={() => onBlockUser(user.id)} className="p-1.5 rounded text-text-muted hover:bg-danger/20 hover:text-danger" title="Block user">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                              </svg>
                            </button>
                          </>
                        )}
                        {user.request_pending && user.request_direction === 'outgoing' && (
                          <button onClick={() => onCancelRequest(user.id)} className="px-3 py-1 text-xs font-medium bg-bg-tertiary text-text-muted rounded hover:bg-danger hover:text-white">Pending</button>
                        )}
                        {user.request_pending && user.request_direction === 'incoming' && (
                          <button onClick={() => onAcceptRequest(user.id)} className="px-3 py-1 text-xs font-medium bg-status-online text-white rounded hover:bg-status-online/80">Accept</button>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* All Friends (when not searching) */}
            {searchQuery.length < 2 && (
              <div className="p-2">
                {friends.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="w-12 h-12 bg-bg-tertiary rounded-full flex items-center justify-center mb-3">
                      <svg className="w-6 h-6 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <p className="text-text-muted text-sm">No friends yet</p>
                    <p className="text-text-muted text-xs mt-1">Search above to find users</p>
                  </div>
                ) : (
                  <>
                    <div className="text-xs font-semibold text-text-muted uppercase px-2 py-1">
                      All Friends — {friends.length}
                    </div>
                    {onlineFriends.map(f => renderFriendItem(f))}
                    {offlineFriends.map(f => renderFriendItem(f, true))}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ONLINE Tab */}
        {activeTab === 'online' && (
          <div className="p-2">
            <div className="text-xs font-semibold text-text-muted uppercase px-2 py-1">
              Online — {onlineFriends.length}
            </div>
            {onlineFriends.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-sm">No friends online</div>
            ) : (
              onlineFriends.map(f => renderFriendItem(f))
            )}
          </div>
        )}

        {/* FRIENDS Tab — same as All but grouped online/offline */}
        {activeTab === 'friends' && (
          <div className="p-2">
            {friends.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-sm">No friends yet</div>
            ) : (
              <>
                {onlineFriends.length > 0 && (
                  <>
                    <div className="text-xs font-semibold text-text-muted uppercase px-2 py-1">
                      Online — {onlineFriends.length}
                    </div>
                    {onlineFriends.map(f => renderFriendItem(f))}
                  </>
                )}
                {offlineFriends.length > 0 && (
                  <>
                    <div className="text-xs font-semibold text-text-muted uppercase px-2 py-1 mt-2">
                      Offline — {offlineFriends.length}
                    </div>
                    {offlineFriends.map(f => renderFriendItem(f, true))}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* PENDING Tab */}
        {activeTab === 'pending' && (
          <div className="p-2">
            {/* Incoming Requests */}
            {incomingRequests.length > 0 && (
              <>
                <div className="text-xs font-semibold text-text-muted uppercase px-2 py-1">
                  Incoming — {incomingRequests.length}
                </div>
                {incomingRequests.map((request) => (
                  <div key={request.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-bg-modifier-hover">
                    <Avatar src={request.user.avatar_url} alt={request.user.display_name || request.user.username} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-primary truncate">{request.user.display_name || request.user.username}</div>
                      <div className="text-xs text-text-muted">@{request.user.username}</div>
                    </div>
                    <button onClick={() => onAcceptRequest(request.user.id)} className="p-1.5 rounded bg-status-online/20 text-status-online hover:bg-status-online/30" title="Accept">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                    <button onClick={() => onRejectRequest(request.user.id)} className="p-1.5 rounded bg-danger/20 text-danger hover:bg-danger/30" title="Reject">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </>
            )}

            {/* Outgoing Requests */}
            {outgoingRequests.length > 0 && (
              <>
                <div className="text-xs font-semibold text-text-muted uppercase px-2 py-1 mt-2">
                  Outgoing — {outgoingRequests.length}
                </div>
                {outgoingRequests.map((request) => (
                  <div key={request.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-bg-modifier-hover">
                    <Avatar src={request.user.avatar_url} alt={request.user.display_name || request.user.username} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-primary truncate">{request.user.display_name || request.user.username}</div>
                      <div className="text-xs text-text-muted">@{request.user.username}</div>
                    </div>
                    <button onClick={() => onCancelRequest(request.user.id)} className="px-3 py-1 text-xs font-medium bg-bg-tertiary text-text-muted rounded hover:bg-danger hover:text-white">Cancel</button>
                  </div>
                ))}
              </>
            )}

            {incomingRequests.length === 0 && outgoingRequests.length === 0 && (
              <div className="text-center py-8 text-text-muted text-sm">No pending requests</div>
            )}
          </div>
        )}

        {/* BLOCKED Tab */}
        {activeTab === 'blocked' && (
          <div className="p-2">
            <div className="text-xs font-semibold text-text-muted uppercase px-2 py-1">
              Blocked — {blockedUsers.length}
            </div>
            {blockedUsers.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-sm">No blocked users</div>
            ) : (
              blockedUsers.map((user) => (
                <div key={user.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-bg-modifier-hover opacity-60">
                  <Avatar src={user.avatar_url} alt={user.display_name || user.username} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">{user.display_name || user.username}</div>
                    <div className="text-xs text-text-muted">@{user.username}</div>
                  </div>
                  <button onClick={() => onUnblockUser(user.id)} className="px-3 py-1 text-xs font-medium bg-bg-tertiary text-text-muted rounded hover:bg-status-online hover:text-white">Unblock</button>
                </div>
              ))
            )}
          </div>
        )}

        {/* IGNORED Tab */}
        {activeTab === 'ignored' && (
          <div className="p-2">
            <div className="text-xs font-semibold text-text-muted uppercase px-2 py-1">
              Ignored — {ignoredUsers.length}
            </div>
            {ignoredUsers.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-sm">No ignored users</div>
            ) : (
              ignoredUsers.map((user) => (
                <div key={user.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-bg-modifier-hover opacity-60">
                  <Avatar src={user.avatar_url} alt={user.display_name || user.username} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">{user.display_name || user.username}</div>
                    <div className="text-xs text-text-muted">@{user.username}</div>
                  </div>
                  <button onClick={() => onUnignoreUser(user.id)} className="px-3 py-1 text-xs font-medium bg-bg-tertiary text-text-muted rounded hover:bg-status-online hover:text-white">Unignore</button>
                </div>
              ))
            )}
          </div>
        )}

        {/* HISTORY Tab — Admin Action History */}
        {activeTab === 'history' && (
          <div className="p-2">
            <div className="text-xs font-semibold text-text-muted uppercase px-2 py-1">
              Actions Against You
            </div>
            {auditLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : auditLog.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-sm">No admin actions recorded</div>
            ) : (
              auditLog.map((entry) => (
                <div key={entry.id} className="p-2 rounded-lg hover:bg-bg-modifier-hover mb-1">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-sm font-medium text-text-primary">{entry.actor_username}</span>
                    <span className="text-xs text-text-muted">performed</span>
                  </div>
                  <div className="text-xs font-medium text-brand-primary mb-0.5">
                    {formatAuditAction(entry.action)}
                  </div>
                  {entry.reason && (
                    <div className="text-xs text-text-muted mt-0.5">
                      Reason: {entry.reason}
                    </div>
                  )}
                  <div className="text-[10px] text-text-muted mt-1">
                    {formatDate(entry.created_at)}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
