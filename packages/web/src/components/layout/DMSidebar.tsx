import { createSignal, For, Show, JSX } from 'solid-js';
import { Avatar } from '@/components/ui';

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

export function DMSidebar(props: DMSidebarProps): JSX.Element {
  const [isSearchMode, setIsSearchMode] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');

  const onlineFriends = () => props.friends.filter(f => f.status !== 'offline');
  const offlineFriends = () => props.friends.filter(f => f.status === 'offline');

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (value.length >= 2) {
      props.onSearch(value);
    }
  };

  const handleFindClick = () => {
    if (isSearchMode()) {
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
    <div class="w-60 bg-bg-secondary flex flex-col h-full border-r border-bg-tertiary">
      {/* Back Button */}
      <div class="p-3 border-b border-bg-tertiary">
        <button
          onClick={props.onBack}
          class="w-full flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-tertiary hover:bg-bg-modifier-hover text-text-primary transition-colors"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span class="font-medium">Back to Server</span>
        </button>
      </div>

      {/* Find Button */}
      <div class="p-3 border-b border-bg-tertiary">
        <button
          onClick={handleFindClick}
          class={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors ${
            isSearchMode() 
              ? 'bg-brand-primary text-white' 
              : 'bg-bg-tertiary hover:bg-bg-modifier-hover text-text-primary'
          }`}
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span class="font-medium">Find</span>
          <Show when={props.pendingRequestCount > 0 && !isSearchMode()}>
            <span class="ml-auto bg-danger text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {props.pendingRequestCount > 9 ? '9+' : props.pendingRequestCount}
            </span>
          </Show>
        </button>
      </div>

      {/* Search Mode Content */}
      <Show when={isSearchMode()}>
        <div class="flex-1 flex flex-col overflow-hidden">
          {/* Search Input */}
          <div class="p-3 border-b border-bg-tertiary">
            <div class="relative">
              <input
                type="text"
                placeholder="Search username..."
                value={searchQuery()}
                onInput={(e) => handleSearchInput(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Escape' && exitSearchMode()}
                class="w-full px-3 py-2 bg-bg-tertiary rounded-lg text-text-primary placeholder:text-text-muted outline-none focus:ring-2 focus:ring-brand-primary"
                autofocus
              />
              <Show when={searchQuery()}>
                <button
                  onClick={() => setSearchQuery('')}
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                >
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </Show>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto scrollbar-thin">
            {/* Incoming Requests */}
            <Show when={props.incomingRequests.length > 0}>
              <div class="p-2">
                <div class="text-xs font-semibold text-text-muted uppercase px-2 py-1">
                  Friend Requests — {props.incomingRequests.length}
                </div>
                <For each={props.incomingRequests}>
                  {(request) => (
                    <div class="flex items-center gap-2 p-2 rounded-lg hover:bg-bg-modifier-hover">
                      <Avatar
                        src={request.user.avatar_url}
                        alt={request.user.display_name || request.user.username}
                        size="sm"
                      />
                      <div class="flex-1 min-w-0">
                        <div class="text-sm font-medium text-text-primary truncate">
                          {request.user.display_name || request.user.username}
                        </div>
                        <div class="text-xs text-text-muted">@{request.user.username}</div>
                      </div>
                      <button
                        onClick={() => props.onAcceptRequest(request.user.id)}
                        class="p-1.5 rounded bg-status-online/20 text-status-online hover:bg-status-online/30"
                        title="Accept"
                      >
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => props.onRejectRequest(request.user.id)}
                        class="p-1.5 rounded bg-danger/20 text-danger hover:bg-danger/30"
                        title="Reject"
                      >
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Search Results */}
            <Show when={searchQuery().length >= 2}>
              <div class="p-2">
                <div class="text-xs font-semibold text-text-muted uppercase px-2 py-1">
                  Search Results
                </div>
                <Show when={props.isSearching}>
                  <div class="flex items-center justify-center py-4">
                    <div class="w-5 h-5 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                </Show>
                <Show when={!props.isSearching && props.searchResults.length === 0}>
                  <div class="text-center py-4 text-text-muted text-sm">
                    No users found
                  </div>
                </Show>
                <For each={props.searchResults}>
                  {(user) => (
                    <div class="flex items-center gap-2 p-2 rounded-lg hover:bg-bg-modifier-hover">
                      <Avatar
                        src={user.avatar_url}
                        alt={user.display_name || user.username}
                        size="sm"
                      />
                      <div class="flex-1 min-w-0">
                        <div class="text-sm font-medium text-text-primary truncate">
                          {user.display_name || user.username}
                        </div>
                        <div class="text-xs text-text-muted">@{user.username}</div>
                      </div>
                      <Show when={user.is_blocked}>
                        <button
                          onClick={() => props.onUnblockUser(user.id)}
                          class="px-3 py-1 text-xs font-medium bg-danger/20 text-danger rounded hover:bg-danger hover:text-white"
                        >
                          Blocked
                        </button>
                      </Show>
                      <Show when={!user.is_blocked}>
                        <Show when={user.is_friend}>
                          <span class="text-xs text-status-online font-medium">Friends</span>
                        </Show>
                        <Show when={!user.is_friend && !user.request_pending}>
                          <button
                            onClick={() => props.onAddFriend(user.id)}
                            class="px-3 py-1 text-xs font-medium bg-brand-primary text-white rounded hover:bg-brand-primary/80"
                          >
                            Add
                          </button>
                          <button
                            onClick={() => props.onBlockUser(user.id)}
                            class="p-1.5 rounded text-text-muted hover:bg-danger/20 hover:text-danger"
                            title="Block user"
                          >
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                          </button>
                        </Show>
                        <Show when={user.request_pending && user.request_direction === 'outgoing'}>
                          <button
                            onClick={() => props.onCancelRequest(user.id)}
                            class="px-3 py-1 text-xs font-medium bg-bg-tertiary text-text-muted rounded hover:bg-danger hover:text-white"
                          >
                            Pending
                          </button>
                        </Show>
                        <Show when={user.request_pending && user.request_direction === 'incoming'}>
                          <button
                            onClick={() => props.onAcceptRequest(user.id)}
                            class="px-3 py-1 text-xs font-medium bg-status-online text-white rounded hover:bg-status-online/80"
                          >
                            Accept
                          </button>
                        </Show>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Outgoing Requests */}
            <Show when={props.outgoingRequests.length > 0 && searchQuery().length < 2}>
              <div class="p-2">
                <div class="text-xs font-semibold text-text-muted uppercase px-2 py-1">
                  Pending — {props.outgoingRequests.length}
                </div>
                <For each={props.outgoingRequests}>
                  {(request) => (
                    <div class="flex items-center gap-2 p-2 rounded-lg hover:bg-bg-modifier-hover">
                      <Avatar
                        src={request.user.avatar_url}
                        alt={request.user.display_name || request.user.username}
                        size="sm"
                      />
                      <div class="flex-1 min-w-0">
                        <div class="text-sm font-medium text-text-primary truncate">
                          {request.user.display_name || request.user.username}
                        </div>
                        <div class="text-xs text-text-muted">@{request.user.username}</div>
                      </div>
                      <button
                        onClick={() => props.onCancelRequest(request.user.id)}
                        class="px-3 py-1 text-xs font-medium bg-bg-tertiary text-text-muted rounded hover:bg-danger hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Blocked Users */}
            <Show when={props.blockedUsers.length > 0 && searchQuery().length < 2}>
              <div class="p-2 border-t border-bg-tertiary">
                <div class="text-xs font-semibold text-text-muted uppercase px-2 py-1">
                  Blocked — {props.blockedUsers.length}
                </div>
                <For each={props.blockedUsers}>
                  {(user) => (
                    <div class="flex items-center gap-2 p-2 rounded-lg hover:bg-bg-modifier-hover opacity-60">
                      <Avatar
                        src={user.avatar_url}
                        alt={user.display_name || user.username}
                        size="sm"
                      />
                      <div class="flex-1 min-w-0">
                        <div class="text-sm font-medium text-text-primary truncate">
                          {user.display_name || user.username}
                        </div>
                        <div class="text-xs text-text-muted">@{user.username}</div>
                      </div>
                      <button
                        onClick={() => props.onUnblockUser(user.id)}
                        class="px-3 py-1 text-xs font-medium bg-bg-tertiary text-text-muted rounded hover:bg-status-online hover:text-white"
                      >
                        Unblock
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* Normal Friend List Mode */}
      <Show when={!isSearchMode()}>
        <div class="flex-1 overflow-y-auto scrollbar-thin">
          {/* Friends Section */}
          <div class="p-2">
            <div class="text-xs font-semibold text-text-muted uppercase px-2 py-1">
              Friends — {onlineFriends().length}
            </div>
            <For each={onlineFriends()}>
              {(friend) => (
                <button
                  onClick={() => props.onSelectFriend(friend)}
                  class={`w-full flex items-center gap-2 p-2 rounded-lg transition-colors ${
                    props.selectedFriendId === friend.id 
                      ? 'bg-bg-modifier-selected' 
                      : 'hover:bg-bg-modifier-hover'
                  }`}
                >
                  <div class="relative flex-shrink-0">
                    <Avatar
                      src={friend.avatar_url}
                      alt={friend.display_name || friend.username}
                      size="sm"
                    />
                    <div class={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-bg-secondary ${getStatusColor(friend.status)}`} />
                  </div>
                  <div class="flex-1 min-w-0 text-left">
                    <div class="text-sm font-medium text-text-primary truncate">
                      {friend.display_name || friend.username}
                    </div>
                    <Show when={friend.custom_status}>
                      <div class="text-xs text-text-muted truncate">
                        {friend.custom_status}
                      </div>
                    </Show>
                  </div>
                  <Show when={friend.unread_count && friend.unread_count > 0}>
                    <span class="bg-danger text-white text-xs font-bold px-2 py-0.5 rounded-full">
                      {friend.unread_count > 9 ? '9+' : friend.unread_count}
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>

          {/* Offline Section */}
          <Show when={offlineFriends().length > 0}>
            <div class="p-2 border-t border-bg-tertiary">
              <div class="text-xs font-semibold text-text-muted uppercase px-2 py-1">
                Offline — {offlineFriends().length}
              </div>
              <For each={offlineFriends()}>
                {(friend) => (
                  <button
                    onClick={() => props.onSelectFriend(friend)}
                    class={`w-full flex items-center gap-2 p-2 rounded-lg transition-colors opacity-60 ${
                      props.selectedFriendId === friend.id 
                        ? 'bg-bg-modifier-selected opacity-100' 
                        : 'hover:bg-bg-modifier-hover hover:opacity-100'
                    }`}
                  >
                    <div class="relative flex-shrink-0">
                      <Avatar
                        src={friend.avatar_url}
                        alt={friend.display_name || friend.username}
                        size="sm"
                      />
                      <div class={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-bg-secondary ${getStatusColor(friend.status)}`} />
                    </div>
                    <div class="flex-1 min-w-0 text-left">
                      <div class="text-sm font-medium text-text-primary truncate">
                        {friend.display_name || friend.username}
                      </div>
                      <Show when={friend.custom_status}>
                        <div class="text-xs text-text-muted truncate">
                          {friend.custom_status}
                        </div>
                      </Show>
                    </div>
                    <Show when={friend.unread_count && friend.unread_count > 0}>
                      <span class="bg-danger text-white text-xs font-bold px-2 py-0.5 rounded-full">
                        {friend.unread_count > 9 ? '9+' : friend.unread_count}
                      </span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>

          {/* Empty State */}
          <Show when={props.friends.length === 0}>
            <div class="flex flex-col items-center justify-center h-full p-4 text-center">
              <div class="w-16 h-16 bg-bg-tertiary rounded-full flex items-center justify-center mb-4">
                <svg class="w-8 h-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <p class="text-text-muted text-sm mb-2">No friends yet</p>
              <p class="text-text-muted text-xs">Click Find to search for friends</p>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
