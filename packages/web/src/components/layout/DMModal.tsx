import { useState, useMemo } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { MessageContent } from '@/components/ui/MessageContent';

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

export function DMModal({
  isOpen,
  onClose,
  users,
  conversations,
  currentUserId,
  onSendMessage,
}: DMModalProps) {
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const handleClose = () => {
    setSelectedUser(null);
    setMessageInput('');
    setSearchQuery('');
    onClose();
  };

  const handleSend = () => {
    const content = messageInput.trim();
    if (content && selectedUser && onSendMessage) {
      onSendMessage(selectedUser.id, content);
      setMessageInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const filteredUsers = useMemo(() => {
    const query = searchQuery.toLowerCase();
    if (!query) return users;
    return users.filter(user =>
      user.username.toLowerCase().includes(query) ||
      (user.display_name?.toLowerCase().includes(query))
    );
  }, [users, searchQuery]);

  const getConversation = (user: User) => {
    return conversations.find(c => c.user.id === user.id);
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

  if (!isOpen) return null;

  const conversation = selectedUser ? getConversation(selectedUser) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-bg-primary rounded-xl shadow-2xl border border-bg-tertiary w-full max-w-4xl h-[600px] mx-4 flex overflow-hidden">
        {/* Left Panel - User List */}
        <div className="w-72 border-r border-bg-tertiary flex flex-col bg-bg-secondary">
          {/* Header */}
          <div className="p-4 border-b border-bg-tertiary">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-text-primary">Direct Messages</h2>
              <button
                onClick={handleClose}
                className="p-1 text-text-muted hover:text-text-primary transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Search */}
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-bg-tertiary rounded-lg text-sm text-text-primary placeholder:text-text-muted outline-none focus:ring-2 focus:ring-brand-primary"
              />
            </div>
          </div>

          {/* User List */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {filteredUsers.map((user) => {
              const conv = getConversation(user);
              return (
                <button
                  key={user.id}
                  onClick={() => setSelectedUser(user)}
                  className={`w-full p-3 flex items-center gap-3 hover:bg-bg-modifier-hover transition-colors ${
                    selectedUser?.id === user.id ? 'bg-bg-modifier-selected' : ''
                  }`}
                >
                  <div className="relative flex-shrink-0">
                    <Avatar
                      src={user.avatar_url}
                      alt={user.display_name || user.username}
                      size="sm"
                    />
                    <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-bg-secondary ${getStatusColor(user.status)}`} />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="font-medium text-text-primary truncate">
                      {user.display_name || user.username}
                    </div>
                    <div className="text-xs text-text-muted truncate">
                      @{user.username}
                    </div>
                  </div>
                  {conv && conv.unread_count > 0 && (
                    <div className="w-5 h-5 bg-brand-primary rounded-full flex items-center justify-center">
                      <span className="text-xs text-white font-medium">
                        {conv.unread_count > 9 ? '9+' : conv.unread_count}
                      </span>
                    </div>
                  )}
                </button>
              );
            })}

            {filteredUsers.length === 0 && (
              <div className="p-4 text-center text-text-muted text-sm">
                No users found
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Conversation */}
        <div className="flex-1 flex flex-col bg-bg-primary">
          {selectedUser ? (
            <>
              {/* Conversation Header */}
              <div className="h-14 px-4 flex items-center gap-3 border-b border-bg-tertiary">
                <div className="relative">
                  <Avatar
                    src={selectedUser.avatar_url}
                    alt={selectedUser.display_name || selectedUser.username}
                    size="sm"
                  />
                  <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-bg-primary ${getStatusColor(selectedUser.status)}`} />
                </div>
                <div>
                  <div className="font-medium text-text-primary">
                    {selectedUser.display_name || selectedUser.username}
                  </div>
                  <div className="text-xs text-text-muted">
                    @{selectedUser.username}
                  </div>
                </div>
                {/* Encryption indicator */}
                <div className="ml-auto flex items-center gap-2 text-status-online">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span className="text-xs">End-to-End Encrypted</span>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
                {conversation && conversation.messages.length > 0 ? (
                  conversation.messages.map((message) => {
                    const isMe = message.sender_id === currentUserId;
                    return (
                      <div key={message.id} className="flex mb-3 justify-start">
                        <div className="max-w-[85%]">
                          <div className="flex items-baseline gap-2 mb-0.5">
                            <span className={`text-xs font-medium ${isMe ? 'text-brand-primary' : 'text-text-primary'}`}>
                              {isMe ? 'You' : (selectedUser.display_name || selectedUser.username)}
                            </span>
                            <span className="text-[10px] text-text-muted">
                              {formatTime(message.created_at)}
                            </span>
                          </div>
                          <div className="text-text-primary">
                            <MessageContent content={message.content} compact={true} />
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <Avatar
                      src={selectedUser.avatar_url}
                      alt={selectedUser.display_name || selectedUser.username}
                      size="xl"
                    />
                    <h3 className="text-lg font-medium text-text-primary mt-4 mb-1">
                      {selectedUser.display_name || selectedUser.username}
                    </h3>
                    <p className="text-text-muted text-sm mb-4">
                      @{selectedUser.username}
                    </p>
                    <p className="text-text-muted text-sm">
                      This is the beginning of your direct message history with{' '}
                      <span className="font-medium">{selectedUser.display_name || selectedUser.username}</span>.
                    </p>
                    <p className="text-xs text-status-online flex items-center gap-1 mt-2">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      Messages are end-to-end encrypted
                    </p>
                  </div>
                )}
              </div>

              {/* Message Input */}
              <div className="p-4 border-t border-bg-tertiary">
                <div className="flex items-center gap-2 bg-bg-tertiary rounded-lg px-4 py-2">
                  <input
                    type="text"
                    placeholder={`Message @${selectedUser.username}`}
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted outline-none"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!messageInput.trim()}
                    className="p-2 text-text-muted hover:text-brand-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-20 h-20 mx-auto mb-4 bg-bg-tertiary rounded-full flex items-center justify-center">
                  <svg className="w-10 h-10 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-text-primary mb-2">Select a Conversation</h3>
                <p className="text-text-muted text-sm">
                  Choose a user from the list to start messaging
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
