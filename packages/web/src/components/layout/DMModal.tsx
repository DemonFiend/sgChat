import { createSignal, For, Show } from 'solid-js';
import { Avatar } from '@/components/ui';

interface User {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  status: 'online' | 'idle' | 'dnd' | 'offline';
}

interface DMMessage {
  id: string;
  content: string;
  sender_id: string;
  created_at: string;
  encrypted: boolean;
}

interface DMConversation {
  user: User;
  messages: DMMessage[];
  unread_count: number;
}

interface DMModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  conversations: DMConversation[];
  currentUserId: string;
  onSendMessage?: (userId: string, content: string) => void;
}

export function DMModal(props: DMModalProps) {
  const [selectedUser, setSelectedUser] = createSignal<User | null>(null);
  const [messageInput, setMessageInput] = createSignal('');
  const [searchQuery, setSearchQuery] = createSignal('');

  const handleClose = () => {
    setSelectedUser(null);
    setMessageInput('');
    setSearchQuery('');
    props.onClose();
  };

  const handleSend = () => {
    const content = messageInput().trim();
    const user = selectedUser();
    if (content && user && props.onSendMessage) {
      props.onSendMessage(user.id, content);
      setMessageInput('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const filteredUsers = () => {
    const query = searchQuery().toLowerCase();
    if (!query) return props.users;
    return props.users.filter(user => 
      user.username.toLowerCase().includes(query) ||
      (user.display_name?.toLowerCase().includes(query))
    );
  };

  const getConversation = (user: User) => {
    return props.conversations.find(c => c.user.id === user.id);
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-status-online';
      case 'idle': return 'bg-status-idle';
      case 'dnd': return 'bg-status-dnd';
      default: return 'bg-status-offline';
    }
  };

  if (!props.isOpen) return null;

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        class="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />
      
      {/* Modal */}
      <div class="relative bg-bg-primary rounded-xl shadow-2xl border border-bg-tertiary w-full max-w-4xl h-[600px] mx-4 flex overflow-hidden">
        {/* Left Panel - User List */}
        <div class="w-72 border-r border-bg-tertiary flex flex-col bg-bg-secondary">
          {/* Header */}
          <div class="p-4 border-b border-bg-tertiary">
            <div class="flex items-center justify-between mb-3">
              <h2 class="text-lg font-semibold text-text-primary">Direct Messages</h2>
              <button
                onClick={handleClose}
                class="p-1 text-text-muted hover:text-text-primary transition-colors"
              >
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Search */}
            <div class="relative">
              <svg 
                class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search users..."
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                class="w-full pl-9 pr-4 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary placeholder:text-text-muted outline-none focus:ring-2 focus:ring-brand-primary"
              />
            </div>
          </div>

          {/* User List */}
          <div class="flex-1 overflow-y-auto scrollbar-thin">
            <For each={filteredUsers()}>
              {(user) => {
                const conversation = getConversation(user);
                return (
                  <button
                    onClick={() => setSelectedUser(user)}
                    class={`w-full p-3 flex items-center gap-3 hover:bg-bg-modifier-hover transition-colors ${
                      selectedUser()?.id === user.id ? 'bg-bg-modifier-selected' : ''
                    }`}
                  >
                    <div class="relative flex-shrink-0">
                      <Avatar
                        src={user.avatar_url}
                        alt={user.display_name || user.username}
                        size="sm"
                      />
                      <div class={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-bg-secondary ${getStatusColor(user.status)}`} />
                    </div>
                    <div class="flex-1 min-w-0 text-left">
                      <div class="font-medium text-text-primary truncate">
                        {user.display_name || user.username}
                      </div>
                      <div class="text-xs text-text-muted truncate">
                        @{user.username}
                      </div>
                    </div>
                    <Show when={conversation && conversation.unread_count > 0}>
                      <div class="w-5 h-5 bg-brand-primary rounded-full flex items-center justify-center">
                        <span class="text-xs text-white font-medium">
                          {conversation!.unread_count > 9 ? '9+' : conversation!.unread_count}
                        </span>
                      </div>
                    </Show>
                  </button>
                );
              }}
            </For>

            <Show when={filteredUsers().length === 0}>
              <div class="p-4 text-center text-text-muted text-sm">
                No users found
              </div>
            </Show>
          </div>
        </div>

        {/* Right Panel - Conversation */}
        <div class="flex-1 flex flex-col bg-bg-primary">
          <Show
            when={selectedUser()}
            fallback={
              <div class="flex-1 flex items-center justify-center">
                <div class="text-center">
                  <div class="w-20 h-20 mx-auto mb-4 bg-bg-tertiary rounded-full flex items-center justify-center">
                    <svg class="w-10 h-10 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <h3 class="text-lg font-medium text-text-primary mb-2">Select a Conversation</h3>
                  <p class="text-text-muted text-sm">
                    Choose a user from the list to start messaging
                  </p>
                </div>
              </div>
            }
          >
            {/* Conversation Header */}
            <div class="h-14 px-4 flex items-center gap-3 border-b border-bg-tertiary">
              <div class="relative">
                <Avatar
                  src={selectedUser()!.avatar_url}
                  alt={selectedUser()!.display_name || selectedUser()!.username}
                  size="sm"
                />
                <div class={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-bg-primary ${getStatusColor(selectedUser()!.status)}`} />
              </div>
              <div>
                <div class="font-medium text-text-primary">
                  {selectedUser()!.display_name || selectedUser()!.username}
                </div>
                <div class="text-xs text-text-muted">
                  @{selectedUser()!.username}
                </div>
              </div>
              {/* Encryption indicator */}
              <div class="ml-auto flex items-center gap-2 text-status-online">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span class="text-xs">End-to-End Encrypted</span>
              </div>
            </div>

            {/* Messages */}
            <div class="flex-1 overflow-y-auto scrollbar-thin p-4">
              <Show when={getConversation(selectedUser()!)}>
                <For each={getConversation(selectedUser()!)?.messages || []}>
                  {(message) => {
                    const isMe = message.sender_id === props.currentUserId;
                    return (
                      <div class={`flex mb-3 ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <div class={`max-w-[70%] rounded-2xl px-4 py-2 ${
                          isMe 
                            ? 'bg-brand-primary text-white rounded-br-md' 
                            : 'bg-bg-tertiary text-text-primary rounded-bl-md'
                        }`}>
                          <p class="break-words">{message.content}</p>
                          <div class={`text-[10px] mt-1 ${isMe ? 'text-white/70' : 'text-text-muted'}`}>
                            {formatTime(message.created_at)}
                          </div>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </Show>
              
              <Show when={!getConversation(selectedUser()!) || getConversation(selectedUser()!)?.messages.length === 0}>
                <div class="flex flex-col items-center justify-center h-full text-center">
                  <Avatar
                    src={selectedUser()!.avatar_url}
                    alt={selectedUser()!.display_name || selectedUser()!.username}
                    size="xl"
                  />
                  <h3 class="text-lg font-medium text-text-primary mt-4 mb-1">
                    {selectedUser()!.display_name || selectedUser()!.username}
                  </h3>
                  <p class="text-text-muted text-sm mb-4">
                    @{selectedUser()!.username}
                  </p>
                  <p class="text-text-muted text-sm">
                    This is the beginning of your direct message history with{' '}
                    <span class="font-medium">{selectedUser()!.display_name || selectedUser()!.username}</span>.
                  </p>
                  <p class="text-xs text-status-online flex items-center gap-1 mt-2">
                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Messages are end-to-end encrypted
                  </p>
                </div>
              </Show>
            </div>

            {/* Message Input */}
            <div class="p-4 border-t border-bg-tertiary">
              <div class="flex items-center gap-2 bg-bg-tertiary rounded-lg px-4 py-2">
                <input
                  type="text"
                  placeholder={`Message @${selectedUser()!.username}`}
                  value={messageInput()}
                  onInput={(e) => setMessageInput(e.currentTarget.value)}
                  onKeyDown={handleKeyDown}
                  class="flex-1 bg-transparent text-text-primary placeholder:text-text-muted outline-none"
                />
                <button
                  onClick={handleSend}
                  disabled={!messageInput().trim()}
                  class="p-2 text-text-muted hover:text-brand-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
