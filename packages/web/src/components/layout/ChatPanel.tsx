import { createSignal, For, Show, createEffect, onCleanup } from 'solid-js';
import { Avatar, ReactionDisplay, ReactionPicker, MessageContent, type Reaction } from '@/components/ui';
import { GifPicker } from '@/components/ui/GifPicker';

export interface MessageAuthor {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  role_color?: string | null;
}

export interface SystemEvent {
  type: 'member_join' | 'member_leave' | string;
  user_id?: string;
  username?: string;
  timestamp?: string;
}

export interface Message {
  id: string;
  content: string;
  author: MessageAuthor;
  created_at: string;
  edited_at: string | null;
  attachments?: any[];
  reply_to_id?: string | null;
  reactions?: Reaction[];
  type?: 'system' | 'default';
  system_event?: SystemEvent;
}

export interface ChannelInfo {
  id: string;
  name: string;
  topic?: string;
  type: 'text' | 'voice' | 'announcement';
}

export interface TypingUser {
  id: string;
  username: string;
}

interface ChatPanelProps {
  channel: ChannelInfo | null;
  messages: Message[];
  onSendMessage?: (content: string) => void;
  onReactionAdd?: (messageId: string, emoji: string) => void;
  onReactionRemove?: (messageId: string, emoji: string) => void;
  onTypingStart?: () => void;
  onTypingStop?: () => void;
  currentUserId?: string;
  typingUsers?: TypingUser[];
  isMemberListOpen?: boolean;
  onToggleMemberList?: () => void;
}

export function ChatPanel(props: ChatPanelProps) {
  const [messageInput, setMessageInput] = createSignal('');
  const [showGifPicker, setShowGifPicker] = createSignal(false);
  let messagesEndRef: HTMLDivElement | undefined;
  let inputRef: HTMLTextAreaElement | undefined;
  let gifButtonRef: HTMLButtonElement | undefined;
  let typingTimeout: ReturnType<typeof setTimeout> | null = null;
  let isTyping = false;

  // Auto-scroll to bottom when new messages arrive
  createEffect(() => {
    if (props.messages.length > 0 && messagesEndRef) {
      messagesEndRef.scrollIntoView({ behavior: 'smooth' });
    }
  });

  // Cleanup typing timeout on unmount
  onCleanup(() => {
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }
    if (isTyping) {
      props.onTypingStop?.();
    }
  });

  const handleTyping = () => {
    if (!isTyping) {
      isTyping = true;
      props.onTypingStart?.();
    }

    // Reset the timeout
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }

    // Stop typing after 3 seconds of inactivity
    typingTimeout = setTimeout(() => {
      if (isTyping) {
        isTyping = false;
        props.onTypingStop?.();
      }
    }, 3000);
  };

  const handleSend = () => {
    const content = messageInput().trim();
    if (content && props.onSendMessage) {
      // Stop typing when sending
      if (isTyping) {
        isTyping = false;
        props.onTypingStop?.();
        if (typingTimeout) {
          clearTimeout(typingTimeout);
          typingTimeout = null;
        }
      }
      props.onSendMessage(content);
      setMessageInput('');
      inputRef?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Check if a message is a system message
  const isSystemMessage = (message: Message) => {
    return message.type === 'system' || message.system_event != null;
  };

  // Group messages by author for consecutive messages
  const shouldShowAuthor = (message: Message, index: number) => {
    // System messages always get their own styling
    if (isSystemMessage(message)) return true;

    if (index === 0) return true;
    const prevMessage = props.messages[index - 1];

    // Defensive check: if either message has no author, show author header
    if (!prevMessage?.author?.id || !message?.author?.id) return true;

    // If previous was a system message, always show author for current
    if (isSystemMessage(prevMessage)) return true;

    if (prevMessage.author.id !== message.author.id) return true;

    // Show author if more than 5 minutes apart
    const prevTime = new Date(prevMessage.created_at).getTime();
    const currTime = new Date(message.created_at).getTime();
    return currTime - prevTime > 5 * 60 * 1000;
  };

  return (
    <div class="flex flex-col h-full bg-bg-primary">
      {/* Channel Header */}
      <header class="h-12 px-4 flex items-center gap-3 border-b border-bg-tertiary bg-bg-primary shadow-sm flex-shrink-0">
        <div class="flex items-center gap-2">
          <svg class="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
          </svg>
          <span class="font-semibold text-text-primary">
            {props.channel?.name || 'Select a channel'}
          </span>
        </div>
        <Show when={props.channel?.topic}>
          <div class="h-6 w-px bg-border-subtle" />
          <span class="text-sm text-text-muted truncate">
            {props.channel!.topic}
          </span>
        </Show>

        {/* Spacer to push toggle to the right */}
        <div class="flex-1 min-w-0" />

        {/* Member List Toggle Button */}
        <Show when={props.onToggleMemberList}>
          <button
            onClick={props.onToggleMemberList}
            class={`p-2 rounded hover:bg-bg-modifier-hover transition-colors ${props.isMemberListOpen ? 'text-text-primary' : 'text-text-muted'
              }`}
            title={props.isMemberListOpen ? 'Hide member list' : 'Show member list'}
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </button>
        </Show>
      </header>

      {/* Messages Area */}
      <div class="flex-1 overflow-y-auto scrollbar-thin">
        <Show
          when={props.channel}
          fallback={
            <div class="flex-1 flex items-center justify-center h-full">
              <div class="text-center">
                <svg class="w-16 h-16 mx-auto mb-4 text-text-muted opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p class="text-text-muted">Select a channel to start chatting</p>
              </div>
            </div>
          }
        >
          <div class="py-4">
            {/* Welcome message for channel */}
            <div class="px-4 pb-6 mb-4 border-b border-bg-tertiary">
              <div class="w-16 h-16 rounded-full bg-bg-tertiary flex items-center justify-center mb-4">
                <svg class="w-8 h-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                </svg>
              </div>
              <h2 class="text-2xl font-bold text-text-primary mb-1">
                Welcome to #{props.channel?.name}!
              </h2>
              <p class="text-text-muted">
                This is the start of the #{props.channel?.name} channel.
                {props.channel?.topic && ` ${props.channel.topic}`}
              </p>
            </div>

            {/* Messages */}
            <For each={props.messages}>
              {(message, index) => (
                <MessageItem
                  message={message}
                  showAuthor={shouldShowAuthor(message, index())}
                  formatTime={formatTime}
                  onReactionAdd={(emoji) => props.onReactionAdd?.(message.id, emoji)}
                  onReactionRemove={(emoji) => props.onReactionRemove?.(message.id, emoji)}
                  currentUserId={props.currentUserId}
                />
              )}
            </For>
            <div ref={messagesEndRef} />
          </div>
        </Show>
      </div>

      {/* Message Input */}
      <Show when={props.channel}>
        <div class="px-4 pb-4 flex-shrink-0">
          {/* Typing Indicator */}
          <Show when={props.typingUsers && props.typingUsers.length > 0}>
            <div class="flex items-center gap-2 text-xs text-text-muted px-2 pb-1">
              <div class="flex gap-0.5">
                <span class="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ "animation-delay": "0ms" }} />
                <span class="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ "animation-delay": "150ms" }} />
                <span class="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ "animation-delay": "300ms" }} />
              </div>
              <span>
                {props.typingUsers!.length === 1
                  ? `${props.typingUsers![0].username} is typing...`
                  : props.typingUsers!.length === 2
                    ? `${props.typingUsers![0].username} and ${props.typingUsers![1].username} are typing...`
                    : props.typingUsers!.length <= 4
                      ? `${props.typingUsers!.slice(0, -1).map(u => u.username).join(', ')} and ${props.typingUsers![props.typingUsers!.length - 1].username} are typing...`
                      : 'Several people are typing...'}
              </span>
            </div>
          </Show>

          <div class="flex items-end bg-bg-tertiary rounded-lg">
            {/* Attach button */}
            <button class="p-3 text-text-muted hover:text-text-primary transition-colors">
              <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
            </button>

            {/* Text input */}
            <textarea
              ref={inputRef}
              value={messageInput()}
              onInput={(e) => {
                setMessageInput(e.currentTarget.value);
                handleTyping();
              }}
              onKeyDown={handleKeyDown}
              placeholder={`Message #${props.channel?.name || 'channel'}`}
              rows={1}
              class="flex-1 bg-transparent py-3 px-2 text-text-primary placeholder:text-text-muted outline-none resize-none max-h-48 scrollbar-thin"
              style={{ "min-height": "24px" }}
            />

            {/* Emoji button */}
            <button class="p-3 text-text-muted hover:text-text-primary transition-colors">
              <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>

            {/* GIF button */}
            <button
              ref={gifButtonRef}
              onClick={() => setShowGifPicker(!showGifPicker())}
              class="p-3 text-text-muted hover:text-text-primary transition-colors"
              title="Send a GIF"
            >
              <svg class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.5 9H13v6h-1.5V9zM9 9H6c-.5 0-1 .5-1 1v4c0 .5.5 1 1 1h3c.5 0 1-.5 1-1v-4c0-.5-.5-1-1-1zm-.5 4.5h-2v-3h2v3zM19 10.5V9h-4.5v6H16v-2h2v-1.5h-2v-1h3z" />
              </svg>
            </button>

            {/* GIF Picker */}
            <GifPicker
              isOpen={showGifPicker()}
              onClose={() => setShowGifPicker(false)}
              onSelect={(gifUrl) => {
                props.onSendMessage?.(gifUrl);
                setShowGifPicker(false);
              }}
              anchorRef={gifButtonRef}
            />

            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={!messageInput().trim()}
              class="p-3 text-text-muted hover:text-brand-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}

interface MessageItemProps {
  message: Message;
  showAuthor: boolean;
  formatTime: (date: string) => string;
  onReactionAdd?: (emoji: string) => void;
  onReactionRemove?: (emoji: string) => void;
  currentUserId?: string;
}

function MessageItem(props: MessageItemProps) {
  const [showReactionPicker, setShowReactionPicker] = createSignal(false);
  const [actionMenuAnchor, setActionMenuAnchor] = createSignal<HTMLElement | null>(null);

  // Check if this is a system message
  const isSystem = () => props.message.type === 'system' || props.message.system_event != null;

  // Get system event icon based on type
  const getSystemIcon = () => {
    const eventType = props.message.system_event?.type;
    if (eventType === 'member_join') {
      return (
        <svg class="w-5 h-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
        </svg>
      );
    } else if (eventType === 'member_leave') {
      return (
        <svg class="w-5 h-5 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" />
        </svg>
      );
    }
    // Default system icon
    return (
      <svg class="w-5 h-5 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  };

  // Safely get author with fallback
  const author = () => props.message.author || { id: 'unknown', username: 'Unknown User', display_name: null, avatar_url: null };
  const displayName = () => author().display_name || author().username;

  const handleReactionClick = (emoji: string) => {
    const reaction = props.message.reactions?.find(r => r.emoji === emoji);
    if (reaction?.me) {
      props.onReactionRemove?.(emoji);
    } else {
      props.onReactionAdd?.(emoji);
    }
  };

  const handleAddReaction = (emoji: string) => {
    props.onReactionAdd?.(emoji);
    setShowReactionPicker(false);
  };

  // System message rendering (join/leave/etc)
  if (isSystem()) {
    return (
      <div class="px-4 py-2 flex items-center gap-3">
        {/* System icon */}
        <div class="flex-shrink-0 w-10 h-10 rounded-full bg-bg-tertiary flex items-center justify-center">
          {getSystemIcon()}
        </div>

        {/* Content */}
        <div class="flex-1 min-w-0">
          <div class="flex items-baseline gap-2">
            <span class="text-sm font-medium text-text-muted italic">
              System
            </span>
            <span class="text-xs text-text-muted">
              {props.formatTime(props.message.created_at)}
            </span>
          </div>
          <p class="text-sm text-text-muted italic">
            {props.message.content}
          </p>
        </div>
      </div>
    );
  }

  if (props.showAuthor) {
    // Full message with avatar and name
    return (
      <div class="px-4 py-1 hover:bg-bg-modifier-hover group relative">
        <div class="flex gap-4">
          {/* Avatar */}
          <div class="flex-shrink-0 pt-0.5">
            <Avatar
              src={author().avatar_url}
              alt={displayName()}
              size="md"
            />
          </div>

          {/* Content */}
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2">
              <span
                class="font-medium hover:underline cursor-pointer"
                style={{ color: author().role_color || 'var(--color-text-primary)' }}
              >
                {displayName()}
              </span>
              <span class="text-xs text-text-muted">
                {props.formatTime(props.message.created_at)}
              </span>
            </div>
            <div class="text-text-primary">
              <MessageContent content={props.message.content} />
            </div>

            {/* Reactions */}
            <ReactionDisplay
              reactions={props.message.reactions || []}
              onReactionClick={handleReactionClick}
              onAddReaction={() => setShowReactionPicker(true)}
            />
          </div>
        </div>

        {/* Hover Action Buttons */}
        <div class="absolute top-0 right-4 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
          <div class="flex items-center gap-0.5 bg-bg-secondary border border-border-subtle rounded shadow-lg">
            <button
              ref={(el) => setActionMenuAnchor(el)}
              onClick={() => setShowReactionPicker(true)}
              class="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover rounded transition-colors"
              title="Add Reaction"
            >
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            <button
              class="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover rounded transition-colors"
              title="More"
            >
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
              </svg>
            </button>
          </div>
        </div>

        <ReactionPicker
          isOpen={showReactionPicker()}
          onClose={() => setShowReactionPicker(false)}
          onSelect={handleAddReaction}
          anchorRef={actionMenuAnchor()}
        />
      </div>
    );
  }

  // Compact message (continuation from same author)
  return (
    <div class="px-4 py-0.5 hover:bg-bg-modifier-hover group flex items-start relative">
      {/* Timestamp on hover */}
      <span class="w-[40px] flex-shrink-0 text-[10px] text-text-muted opacity-0 group-hover:opacity-100 pt-1 text-right pr-2">
        {props.formatTime(props.message.created_at)}
      </span>
      <div class="w-10 flex-shrink-0" /> {/* Spacer to align with avatar messages */}
      <div class="flex-1 pl-4">
        <div class="text-text-primary">
          <MessageContent content={props.message.content} />
        </div>

        {/* Reactions */}
        <ReactionDisplay
          reactions={props.message.reactions || []}
          onReactionClick={handleReactionClick}
          onAddReaction={() => setShowReactionPicker(true)}
        />
      </div>

      {/* Hover Action Buttons */}
      <div class="absolute top-0 right-4 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
        <div class="flex items-center gap-0.5 bg-bg-secondary border border-border-subtle rounded shadow-lg">
          <button
            ref={(el) => setActionMenuAnchor(el)}
            onClick={() => setShowReactionPicker(true)}
            class="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover rounded transition-colors"
            title="Add Reaction"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button
            class="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover rounded transition-colors"
            title="More"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
            </svg>
          </button>
        </div>
      </div>

      <ReactionPicker
        isOpen={showReactionPicker()}
        onClose={() => setShowReactionPicker(false)}
        onSelect={handleAddReaction}
        anchorRef={actionMenuAnchor()}
      />
    </div>
  );
}
