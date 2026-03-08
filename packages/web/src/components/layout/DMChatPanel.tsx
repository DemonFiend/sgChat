import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { MessageContent } from '@/components/ui/MessageContent';
import { BendyLine } from '@/components/ui/BendyLine';
import { GifPicker } from '@/components/ui/GifPicker';
import { ReactionPicker } from '@/components/ui/ReactionPicker';
import { DMVoiceControls } from '@/components/ui/DMVoiceControls';
import {
  MentionAutocomplete,
  buildAtItems,
  detectTrigger,
  type AutocompleteItem,
} from '@/components/ui/MentionAutocomplete';
import { useMentionContext } from '@/contexts/MentionContext';
import { convertMentionsToWireFormat, shiftMappings, type MentionMapping } from '@/lib/mentionUtils';
import { MAX_MESSAGE_LENGTH } from '@sgchat/shared';
import { api } from '@/api';
import type { Friend } from './DMSidebar';

export interface DMMessage {
  id: string;
  content: string;
  sender_id: string;
  created_at: string;
  edited_at?: string | null;
}

interface DMChatPanelProps {
  friend: Friend | null;
  messages: DMMessage[];
  currentUserId: string;
  currentUserAvatar?: string | null;
  currentUserDisplayName?: string | null;
  onSendMessage: (content: string) => void;
  onTypingStart?: () => void;
  onTypingStop?: () => void;
  isTyping?: boolean;
}

export function DMChatPanel({
  friend,
  messages,
  currentUserId,
  currentUserAvatar,
  currentUserDisplayName,
  onSendMessage,
  onTypingStart,
  onTypingStop,
  isTyping: friendIsTyping,
}: DMChatPanelProps) {
  const [messageInput, setMessageInput] = useState('');
  const [friendLocalTime, setFriendLocalTime] = useState<string | null>(null);
  const [showTimeTooltip, setShowTimeTooltip] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ file: File; previewUrl: string } | null>(null);
  const [pendingSpoiler, setPendingSpoiler] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const gifButtonRef = useRef<HTMLButtonElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const timeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mention autocomplete state
  const [mentionTrigger, setMentionTrigger] = useState<{
    triggerType: '@' | '#';
    triggerStart: number;
    query: string;
  } | null>(null);
  const [mentionMappings, setMentionMappings] = useState<MentionMapping[]>([]);
  const mentionContext = useMentionContext();

  const atItems = useMemo(() => {
    const memberArr = Array.from(mentionContext.members.entries()).map(([id, m]) => ({
      id,
      username: m.username,
      display_name: m.display_name,
      avatar_url: m.avatar_url,
      role_color: m.role_color,
    }));
    return buildAtItems(memberArr, []);
  }, [mentionContext.members]);

  // Calculate friend's local time from their timezone
  const updateFriendTime = useCallback(() => {
    if (friend?.timezone_public && friend?.timezone) {
      try {
        const now = new Date();
        if (friend.timezone_dst_enabled !== false) {
          const time = now.toLocaleTimeString('en-US', {
            timeZone: friend.timezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          });
          setFriendLocalTime(time);
        } else {
          const jan = new Date(now.getFullYear(), 0, 1);
          const janInTz = new Date(jan.toLocaleString('en-US', { timeZone: friend.timezone }));
          const janLocal = new Date(jan.toLocaleString('en-US', { timeZone: 'UTC' }));
          const standardOffset = janInTz.getTime() - janLocal.getTime();
          const utcNow = now.getTime() + (now.getTimezoneOffset() * 60000);
          const standardTime = new Date(utcNow + standardOffset);
          const time = standardTime.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          });
          setFriendLocalTime(time);
        }
      } catch {
        setFriendLocalTime(null);
      }
    } else {
      setFriendLocalTime(null);
    }
  }, [friend?.timezone_public, friend?.timezone, friend?.timezone_dst_enabled]);

  // Update friend's local time when friend changes and every minute
  useEffect(() => {
    if (timeIntervalRef.current) {
      clearInterval(timeIntervalRef.current);
      timeIntervalRef.current = null;
    }
    updateFriendTime();
    if (friend?.timezone_public && friend?.timezone) {
      timeIntervalRef.current = setInterval(updateFriendTime, 60000);
    }
    return () => {
      if (timeIntervalRef.current) clearInterval(timeIntervalRef.current);
    };
  }, [updateFriendTime, friend?.timezone_public, friend?.timezone]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0 && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  // Cleanup typing timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (isTypingRef.current) onTypingStop?.();
      if (timeIntervalRef.current) clearInterval(timeIntervalRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTyping = () => {
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      onTypingStart?.();
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      if (isTypingRef.current) {
        isTypingRef.current = false;
        onTypingStop?.();
      }
    }, 3000);
  };

  const handleMentionSelect = useCallback((item: AutocompleteItem) => {
    if (!mentionTrigger || !inputRef.current) return;
    const before = messageInput.slice(0, mentionTrigger.triggerStart);
    const after = messageInput.slice(mentionTrigger.triggerStart + 1 + mentionTrigger.query.length);
    const insertText = item.insertText + ' ';
    const newInput = before + insertText + after;
    const delta = insertText.length - (1 + mentionTrigger.query.length);
    const shifted = shiftMappings(mentionMappings, mentionTrigger.triggerStart, delta);
    if (item.wireFormat && item.wireFormat !== item.insertText) {
      shifted.push({
        displayText: item.insertText,
        wireFormat: item.wireFormat,
        startIndex: mentionTrigger.triggerStart,
      });
    }
    setMentionMappings(shifted);
    setMessageInput(newInput);
    setMentionTrigger(null);
    const cursorPos = before.length + insertText.length;
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(cursorPos, cursorPos);
      inputRef.current?.focus();
    });
  }, [mentionTrigger, messageInput, mentionMappings]);

  const isOverLimit = messageInput.length > MAX_MESSAGE_LENGTH;
  const charCountVisible = messageInput.length > MAX_MESSAGE_LENGTH * 0.75;

  const handleSendAsTextFile = useCallback(async () => {
    const content = messageInput.trim();
    if (!content) return;
    setIsUploading(true);
    try {
      const blob = new Blob([content], { type: 'text/plain' });
      const file = new File([blob], 'message.txt', { type: 'text/plain' });
      const result = await api.upload<{ url: string }>('/upload', file);
      onSendMessage(result.url);
      setMessageInput('');
      setMentionMappings([]);
      inputRef.current?.focus();
    } catch (err) {
      console.error('Text file upload failed:', err);
    } finally {
      setIsUploading(false);
    }
  }, [messageInput, onSendMessage]);

  const handleSend = () => {
    const content = messageInput.trim();
    if (content && content.length <= MAX_MESSAGE_LENGTH) {
      if (isTypingRef.current) {
        isTypingRef.current = false;
        onTypingStop?.();
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = null;
        }
      }
      const wireContent = mentionMappings.length > 0
        ? convertMentionsToWireFormat(content, mentionMappings)
        : content;
      onSendMessage(wireContent);
      setMessageInput('');
      setMentionMappings([]);
      setMentionTrigger(null);
      // Reset textarea height after sending
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }
      inputRef.current?.focus();
    }
  };

  const handleFileUpload = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*,audio/*,.pdf,.txt,.zip';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.type.startsWith('image/')) {
        const previewUrl = URL.createObjectURL(file);
        setPendingFile({ file, previewUrl });
        setPendingSpoiler(false);
        return;
      }
      setIsUploading(true);
      api.upload<{ url: string }>('/upload', file)
        .then((result) => onSendMessage(result.url))
        .catch((err) => console.error('File upload failed:', err))
        .finally(() => setIsUploading(false));
    };
    input.click();
  }, [onSendMessage]);

  const handlePendingFileSend = useCallback(async () => {
    if (!pendingFile) return;
    setIsUploading(true);
    try {
      const result = await api.upload<{ url: string }>('/upload', pendingFile.file);
      const content = pendingSpoiler ? `||${result.url}||` : result.url;
      onSendMessage(content);
    } catch (err) {
      console.error('File upload failed:', err);
    } finally {
      URL.revokeObjectURL(pendingFile.previewUrl);
      setPendingFile(null);
      setPendingSpoiler(false);
      setIsUploading(false);
    }
  }, [pendingFile, pendingSpoiler, onSendMessage]);

  const handlePendingFileCancel = useCallback(() => {
    if (pendingFile) {
      URL.revokeObjectURL(pendingFile.previewUrl);
    }
    setPendingFile(null);
    setPendingSpoiler(false);
  }, [pendingFile]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionTrigger) {
      const handler = (MentionAutocomplete as any)._handleKeyDown;
      if (handler && handler(e)) return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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

  if (!friend) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg-primary">
        <div className="text-center">
          <div className="w-24 h-24 mx-auto mb-4 bg-bg-tertiary rounded-full flex items-center justify-center">
            <svg className="w-12 h-12 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-text-primary mb-2">Select a Friend</h3>
          <p className="text-text-muted text-sm">
            Choose a friend from the list to start chatting
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-bg-primary relative">
      {/* Header with Bendy Line */}
      <div className="relative">
        <header className="h-16 px-4 flex items-center gap-4 bg-bg-primary border-b border-bg-tertiary">
          {/* Friend Info */}
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-text-primary">
              {friend.display_name || friend.username}
            </h2>
            <p className="text-xs text-text-muted">
              {friend.custom_status || `@${friend.username}`}
            </p>
          </div>

          {/* Voice Call Controls */}
          <DMVoiceControls
            dmChannelId={friend.dm_channel_id || ''}
            friendId={friend.id}
            friendName={friend.display_name || friend.username}
          />

          {/* Friend's Local Time */}
          <div className="relative">
            <div
              className="flex items-center gap-1 px-2 py-1 bg-bg-tertiary rounded-md cursor-default"
              onMouseEnter={() => setShowTimeTooltip(true)}
              onMouseLeave={() => setShowTimeTooltip(false)}
            >
              <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-text-muted">
                {friendLocalTime || 'Hidden'}
              </span>
              <svg className="w-3 h-3 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            {showTimeTooltip && (
              <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 bg-bg-floating text-text-primary text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap border border-bg-tertiary z-10">
                {friendLocalTime ? "User's Local Time" : "User's timezone is hidden"}
              </div>
            )}
          </div>

          {/* Large Avatar on right */}
          <div className="relative">
            <Avatar
              src={friend.avatar_url}
              alt={friend.display_name || friend.username}
              size="lg"
            />
            <div className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-bg-primary ${getStatusColor(friend.status)}`} />
          </div>

          {/* Group indicator placeholder */}
          <div className="w-10 h-10 bg-bg-tertiary rounded-full flex items-center justify-center">
            <span className="text-sm font-bold text-text-muted">2</span>
          </div>
        </header>
        <BendyLine variant="horizontal" direction="down" className="absolute bottom-0 left-0 right-0 translate-y-1/2" />
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 mt-2">
        {/* Empty state */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Avatar
              src={friend.avatar_url}
              alt={friend.display_name || friend.username}
              size="xl"
            />
            <h3 className="text-lg font-semibold text-text-primary mt-4 mb-1">
              {friend.display_name || friend.username}
            </h3>
            <p className="text-text-muted text-sm mb-4">
              @{friend.username}
            </p>
            <p className="text-text-muted text-sm">
              This is the beginning of your direct message history with{' '}
              <span className="font-medium">{friend.display_name || friend.username}</span>.
            </p>
            <p className="text-xs text-status-online flex items-center gap-1 mt-2">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Messages are end-to-end encrypted
            </p>
          </div>
        )}

        {/* Messages */}
        {messages.map((message, index) => {
          const isMe = message.sender_id === currentUserId;
          const senderName = isMe
            ? (currentUserDisplayName || 'You')
            : (friend.display_name || friend.username);
          const senderAvatar = isMe ? currentUserAvatar : friend.avatar_url;

          // Group messages from same sender within 5 minutes
          const prev = index > 0 ? messages[index - 1] : null;
          const showAuthor = !prev
            || prev.sender_id !== message.sender_id
            || new Date(message.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60 * 1000;

          if (showAuthor) {
            return (
              <div key={message.id} className="flex pt-4 pb-0.5 justify-start">
                <div className="flex-shrink-0 mr-2">
                  <Avatar
                    src={senderAvatar}
                    alt={senderName}
                    size="sm"
                  />
                </div>
                <div className="max-w-[85%]">
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className={`text-sm font-medium ${isMe ? 'text-brand-primary' : 'text-text-primary'}`}>
                      {senderName}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {formatTime(message.created_at)}
                    </span>
                  </div>
                  <div className="text-text-primary">
                    <MessageContent content={message.content} isOwnMessage={isMe} />
                  </div>
                </div>
              </div>
            );
          }

          // Compact continuation message
          return (
            <div key={message.id} className="flex py-px justify-start group">
              <div className="w-8 flex-shrink-0 mr-2 flex items-start justify-end pt-0.5">
                <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100">
                  {formatTime(message.created_at)}
                </span>
              </div>
              <div className="max-w-[85%]">
                <div className="text-text-primary">
                  <MessageContent content={message.content} isOwnMessage={isMe} />
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom Section with Bendy Line and Actions */}
      <div className="relative">
        <BendyLine variant="horizontal" direction="up" className="absolute top-0 left-0 right-0 -translate-y-1/2" />

        {/* Typing Indicator */}
        {friendIsTyping && (
          <div className="flex items-center gap-2 text-xs text-text-muted px-4 pt-2">
            <div className="flex gap-0.5">
              <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span>{friend.display_name || friend.username} is typing...</span>
          </div>
        )}

        {/* Pending File Preview */}
        {pendingFile && (
          <div className="flex items-center gap-3 mx-4 mt-2 px-3 py-2 bg-bg-tertiary rounded-lg border border-border-subtle">
            <img
              src={pendingFile.previewUrl}
              alt="Upload preview"
              className={`w-16 h-16 object-cover rounded ${pendingSpoiler ? 'blur-[20px] brightness-50' : ''}`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-primary truncate">{pendingFile.file.name}</p>
              <p className="text-xs text-text-muted">{(pendingFile.file.size / 1024).toFixed(1)} KB</p>
              <label className="flex items-center gap-2 mt-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={pendingSpoiler}
                  onChange={(e) => setPendingSpoiler(e.target.checked)}
                  className="w-4 h-4 rounded border-border-subtle accent-brand-primary"
                />
                <span className="text-xs text-text-muted">Mark as spoiler</span>
              </label>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handlePendingFileCancel}
                className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePendingFileSend}
                disabled={isUploading}
                className="px-3 py-1.5 text-xs bg-brand-primary text-white rounded hover:bg-brand-primary/80 transition-colors disabled:opacity-50"
              >
                {isUploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        )}

        {/* Message Input */}
        <div className="p-4 flex items-end gap-3">
          <div className="flex-1 flex flex-col relative">
            {/* Mention Autocomplete */}
            {mentionTrigger && (
              <MentionAutocomplete
                query={mentionTrigger.query}
                triggerType={mentionTrigger.triggerType}
                items={atItems}
                onSelect={handleMentionSelect}
                onClose={() => setMentionTrigger(null)}
              />
            )}
          <div className="flex items-end bg-bg-tertiary rounded-lg">
            <textarea
              ref={inputRef}
              value={messageInput}
              onChange={(e) => {
                const newValue = e.target.value;
                const cursorPos = e.target.selectionStart ?? newValue.length;
                setMessageInput(newValue);
                handleTyping();
                // Only detect @ triggers in DMs (no # channels)
                const trigger = detectTrigger(newValue, cursorPos);
                setMentionTrigger(trigger?.triggerType === '@' ? trigger : null);

                // Auto-resize textarea to fit content
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
              }}
              onKeyDown={handleKeyDown}
              placeholder={`Message @${friend.username}`}
              rows={1}
              className="flex-1 bg-transparent py-3 px-4 text-text-primary placeholder:text-text-muted outline-none resize-none max-h-32 scrollbar-thin"
              style={{ minHeight: '24px' }}
            />
            {/* Character counter */}
            {charCountVisible && (
              <span className={`px-2 text-xs font-mono select-none whitespace-nowrap ${
                isOverLimit ? 'text-red-400' : messageInput.length > MAX_MESSAGE_LENGTH * 0.9 ? 'text-yellow-400' : 'text-text-muted'
              }`}>
                {messageInput.length}/{MAX_MESSAGE_LENGTH}
              </span>
            )}
            <button
              onClick={handleSend}
              disabled={!messageInput.trim() || isOverLimit}
              className="p-3 text-text-muted hover:text-brand-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>

          {/* Over-limit banner */}
          {isOverLimit && (
            <div className="flex items-center justify-between px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
              <span>Message too long ({messageInput.length}/{MAX_MESSAGE_LENGTH})</span>
              <button
                onClick={handleSendAsTextFile}
                disabled={isUploading}
                className="ml-2 underline hover:text-red-300 transition-colors disabled:opacity-50"
              >
                {isUploading ? 'Uploading...' : 'Send as .txt file'}
              </button>
            </div>
          )}
          </div>

          {/* Bottom Right Action Buttons */}
          <div className="flex items-center gap-2 relative">
            <button
              ref={emojiButtonRef}
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className={`w-10 h-10 bg-bg-tertiary rounded-full flex items-center justify-center transition-colors ${showEmojiPicker ? 'text-brand-primary bg-bg-modifier-hover' : 'text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover'}`}
              title="Emoji"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>

            {/* Emoji Picker */}
            <ReactionPicker
              isOpen={showEmojiPicker}
              onClose={() => setShowEmojiPicker(false)}
              onSelect={(emoji) => {
                setMessageInput(prev => prev + emoji);
                setShowEmojiPicker(false);
                inputRef.current?.focus();
              }}
              anchorRef={emojiButtonRef.current}
            />

            <button
              onClick={handleFileUpload}
              disabled={isUploading}
              className="w-10 h-10 bg-bg-tertiary rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover transition-colors disabled:opacity-50"
              title="Upload a file"
            >
              {isUploading ? (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              )}
            </button>
            <button
              ref={gifButtonRef}
              onClick={() => setShowGifPicker(!showGifPicker)}
              className="w-10 h-10 bg-bg-tertiary rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover transition-colors"
              title="Send a GIF"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.5 9H13v6h-1.5V9zM9 9H6c-.5 0-1 .5-1 1v4c0 .5.5 1 1 1h3c.5 0 1-.5 1-1v-4c0-.5-.5-1-1-1zm-.5 4.5h-2v-3h2v3zM19 10.5V9h-4.5v6H16v-2h2v-1.5h-2v-1h3z" />
              </svg>
            </button>

            {/* GIF Picker */}
            <GifPicker
              isOpen={showGifPicker}
              onClose={() => setShowGifPicker(false)}
              onSelect={(gifUrl) => {
                onSendMessage(gifUrl);
                setShowGifPicker(false);
              }}
              anchorRef={gifButtonRef.current}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
