import { useState, useEffect, useRef, useCallback } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { MessageContent } from '@/components/ui/MessageContent';
import { api } from '@/api';

interface ThreadMessage {
  id: string;
  content: string;
  thread_id: string;
  author: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    role_color?: string | null;
  };
  created_at: string;
  edited_at: string | null;
  attachments: any[];
}

interface ThreadInfo {
  id: string;
  channel_id: string;
  server_id: string;
  parent_message_id: string | null;
  name: string;
  creator_id: string | null;
  creator_username?: string;
  is_private: boolean;
  is_archived: boolean;
  is_locked: boolean;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
}

interface ThreadPanelProps {
  thread: ThreadInfo;
  currentUserId?: string;
  onClose: () => void;
  canManageThreads?: boolean;
}

export type { ThreadInfo };

export function ThreadPanel({
  thread,
  currentUserId: _currentUserId,
  onClose,
  canManageThreads,
}: ThreadPanelProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [messageInput, setMessageInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadMessages = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<{ messages: ThreadMessage[] }>(
        `/threads/${thread.id}/messages`,
      );
      setMessages(res.messages);
    } catch (err) {
      console.error('Failed to load thread messages:', err);
    } finally {
      setLoading(false);
    }
  }, [thread.id]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    const content = messageInput.trim();
    if (!content || sending) return;

    setSending(true);
    try {
      const msg = await api.post<ThreadMessage>(
        `/threads/${thread.id}/messages`,
        { content },
      );
      setMessages((prev) => [...prev, msg]);
      setMessageInput('');
      inputRef.current?.focus();
    } catch (err) {
      console.error('Failed to send thread message:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleArchive = async () => {
    try {
      await api.patch(`/threads/${thread.id}`, {
        is_archived: !thread.is_archived,
      });
    } catch (err) {
      console.error('Failed to toggle archive:', err);
    }
  };

  const handleLock = async () => {
    try {
      await api.patch(`/threads/${thread.id}`, {
        is_locked: !thread.is_locked,
      });
    } catch (err) {
      console.error('Failed to toggle lock:', err);
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isInputDisabled = thread.is_archived || (thread.is_locked && !canManageThreads);

  return (
    <div className="w-80 bg-bg-secondary h-full border-l border-border flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-border flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <svg
              className="w-4 h-4 text-text-muted flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
              />
            </svg>
            <h3 className="text-sm font-semibold text-text-primary truncate">{thread.name}</h3>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {canManageThreads && (
              <>
                <button
                  onClick={handleArchive}
                  className="p-1 rounded hover:bg-bg-modifier-active text-text-muted hover:text-text-primary transition-colors"
                  title={thread.is_archived ? 'Unarchive' : 'Archive'}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                    />
                  </svg>
                </button>
                <button
                  onClick={handleLock}
                  className="p-1 rounded hover:bg-bg-modifier-active text-text-muted hover:text-text-primary transition-colors"
                  title={thread.is_locked ? 'Unlock' : 'Lock'}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    {thread.is_locked ? (
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      />
                    ) : (
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
                      />
                    )}
                  </svg>
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-bg-modifier-active text-text-muted hover:text-text-primary transition-colors"
              title="Close thread"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-text-muted">
            {thread.message_count} {thread.message_count === 1 ? 'message' : 'messages'}
          </span>
          {thread.is_private && (
            <span className="text-xs text-yellow-400 flex items-center gap-0.5">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              Private
            </span>
          )}
          {thread.is_archived && (
            <span className="text-xs text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded">
              Archived
            </span>
          )}
          {thread.is_locked && (
            <span className="text-xs text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded">
              Locked
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin w-6 h-6 border-2 border-brand-primary border-t-transparent rounded-full" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <svg
              className="w-10 h-10 text-text-muted mb-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
              />
            </svg>
            <p className="text-sm text-text-muted">No messages in this thread yet</p>
            <p className="text-xs text-text-muted mt-1">Start the conversation below</p>
          </div>
        ) : (
          messages.map((msg) => {
            const displayName = msg.author.display_name || msg.author.username;
            return (
              <div key={msg.id} className="group">
                <div className="flex items-start gap-2">
                  <Avatar
                    src={msg.author.avatar_url}
                    alt={displayName}
                    size="sm"
                    className="flex-shrink-0 mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span
                        className="text-xs font-medium"
                        style={{
                          color: msg.author.role_color || 'var(--color-text-primary)',
                        }}
                      >
                        {displayName}
                      </span>
                      <span className="text-[10px] text-text-muted">
                        {formatTime(msg.created_at)}
                      </span>
                    </div>
                    <div className="text-sm text-text-primary break-words">
                      <MessageContent content={msg.content} />
                      {msg.edited_at && (
                        <span className="text-[10px] text-text-muted ml-1">(edited)</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      {!isInputDisabled && (
        <div className="p-3 border-t border-border flex-shrink-0">
          <div className="relative">
            <textarea
              ref={inputRef}
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message thread...`}
              className="w-full bg-bg-tertiary rounded-lg px-3 py-2 pr-10 text-sm text-text-primary placeholder-text-muted outline-none resize-none max-h-32"
              rows={1}
              disabled={sending}
            />
            <button
              onClick={handleSendMessage}
              disabled={!messageInput.trim() || sending}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-brand-primary disabled:opacity-30 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
      {isInputDisabled && (
        <div className="p-3 border-t border-border flex-shrink-0">
          <p className="text-xs text-text-muted text-center">
            {thread.is_archived
              ? 'This thread is archived.'
              : 'This thread is locked.'}
          </p>
        </div>
      )}
    </div>
  );
}
