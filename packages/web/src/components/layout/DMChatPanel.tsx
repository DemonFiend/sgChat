import { createSignal, For, Show, createEffect, onCleanup, JSX } from 'solid-js';
import { Avatar } from '@/components/ui';
import { BendyLine } from '@/components/ui/BendyLine';
import { GifPicker } from '@/components/ui/GifPicker';
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

export function DMChatPanel(props: DMChatPanelProps): JSX.Element {
  const [messageInput, setMessageInput] = createSignal('');
  const [friendLocalTime, setFriendLocalTime] = createSignal<string | null>(null);
  const [showTimeTooltip, setShowTimeTooltip] = createSignal(false);
  const [showGifPicker, setShowGifPicker] = createSignal(false);
  let messagesEndRef: HTMLDivElement | undefined;
  let inputRef: HTMLTextAreaElement | undefined;
  let gifButtonRef: HTMLButtonElement | undefined;
  let typingTimeout: ReturnType<typeof setTimeout> | null = null;
  let isTyping = false;
  let timeUpdateInterval: ReturnType<typeof setInterval> | null = null;

  // Calculate friend's local time from their timezone
  // If DST is disabled, we calculate using standard time (January date to avoid DST)
  const updateFriendTime = () => {
    const friend = props.friend;
    if (friend?.timezone_public && friend?.timezone) {
      try {
        const now = new Date();
        
        if (friend.timezone_dst_enabled !== false) {
          // DST enabled (default) - use current time with automatic DST adjustment
          const time = now.toLocaleTimeString('en-US', {
            timeZone: friend.timezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          });
          setFriendLocalTime(time);
        } else {
          // DST disabled - calculate standard time offset
          // Get the standard time offset (using January 1st which is always standard time in northern hemisphere)
          const jan = new Date(now.getFullYear(), 0, 1);
          const janInTz = new Date(jan.toLocaleString('en-US', { timeZone: friend.timezone }));
          const janLocal = new Date(jan.toLocaleString('en-US', { timeZone: 'UTC' }));
          const standardOffset = janInTz.getTime() - janLocal.getTime();
          
          // Apply standard offset to current UTC time
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
  };

  // Update friend's local time when friend changes and every minute
  createEffect(() => {
    // Clear previous interval
    if (timeUpdateInterval) {
      clearInterval(timeUpdateInterval);
      timeUpdateInterval = null;
    }
    
    // Update immediately
    updateFriendTime();
    
    // Update every minute
    if (props.friend?.timezone_public && props.friend?.timezone) {
      timeUpdateInterval = setInterval(updateFriendTime, 60000);
    }
  });

  // Auto-scroll to bottom when new messages arrive
  createEffect(() => {
    if (props.messages.length > 0 && messagesEndRef) {
      messagesEndRef.scrollIntoView({ behavior: 'smooth' });
    }
  });

  // Cleanup typing timeout and time interval on unmount
  onCleanup(() => {
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }
    if (isTyping) {
      props.onTypingStop?.();
    }
    if (timeUpdateInterval) {
      clearInterval(timeUpdateInterval);
    }
  });

  const handleTyping = () => {
    if (!isTyping) {
      isTyping = true;
      props.onTypingStart?.();
    }

    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }

    typingTimeout = setTimeout(() => {
      if (isTyping) {
        isTyping = false;
        props.onTypingStop?.();
      }
    }, 3000);
  };

  const handleSend = () => {
    const content = messageInput().trim();
    if (content) {
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-status-online';
      case 'idle': return 'bg-status-idle';
      case 'dnd': return 'bg-status-dnd';
      default: return 'bg-status-offline';
    }
  };

  // Use Show for reactive conditional rendering - this is critical in SolidJS
  // Early returns with if() break reactivity since the component function only runs once
  return (
    <Show
      when={props.friend}
      fallback={
        <div class="flex-1 flex items-center justify-center bg-bg-primary">
          <div class="text-center">
            <div class="w-24 h-24 mx-auto mb-4 bg-bg-tertiary rounded-full flex items-center justify-center">
              <svg class="w-12 h-12 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h3 class="text-xl font-semibold text-text-primary mb-2">Select a Friend</h3>
            <p class="text-text-muted text-sm">
              Choose a friend from the list to start chatting
            </p>
          </div>
        </div>
      }
    >
      {(friend) => (
        <div class="flex-1 flex flex-col bg-bg-primary relative">
          {/* Header with Bendy Line */}
          <div class="relative">
            <header class="h-16 px-4 flex items-center gap-4 bg-bg-primary border-b border-bg-tertiary">
              {/* Friend Info */}
              <div class="flex-1">
                <h2 class="text-lg font-semibold text-text-primary">
                  {friend().display_name || friend().username}
                </h2>
                <p class="text-xs text-text-muted">
                  {friend().custom_status || `@${friend().username}`}
                </p>
              </div>

              {/* Friend's Local Time */}
              <div class="relative">
                <div 
                  class="flex items-center gap-1 px-2 py-1 bg-bg-tertiary rounded-md cursor-default"
                  onMouseEnter={() => setShowTimeTooltip(true)}
                  onMouseLeave={() => setShowTimeTooltip(false)}
                >
                  <svg class="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span class="text-sm text-text-muted">
                    {friendLocalTime() || 'Hidden'}
                  </span>
                  <svg class="w-3 h-3 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <Show when={showTimeTooltip()}>
                  <div class="absolute top-full mt-1 left-1/2 -translate-x-1/2 bg-bg-floating text-text-primary text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap border border-bg-tertiary z-10">
                    {friendLocalTime() ? "User's Local Time" : "User's timezone is hidden"}
                  </div>
                </Show>
              </div>

              {/* Large Avatar on right */}
              <div class="relative">
                <Avatar
                  src={friend().avatar_url}
                  alt={friend().display_name || friend().username}
                  size="lg"
                />
                <div class={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-bg-primary ${getStatusColor(friend().status)}`} />
              </div>

              {/* Group indicator placeholder */}
              <div class="w-10 h-10 bg-bg-tertiary rounded-full flex items-center justify-center">
                <span class="text-sm font-bold text-text-muted">2</span>
              </div>
            </header>
            <BendyLine variant="horizontal" direction="down" class="absolute bottom-0 left-0 right-0 translate-y-1/2" />
          </div>

          {/* Messages Area */}
          <div class="flex-1 overflow-y-auto scrollbar-thin p-4 mt-2">
            {/* Empty state */}
            <Show when={props.messages.length === 0}>
              <div class="flex flex-col items-center justify-center h-full text-center">
                <Avatar
                  src={friend().avatar_url}
                  alt={friend().display_name || friend().username}
                  size="xl"
                />
                <h3 class="text-lg font-semibold text-text-primary mt-4 mb-1">
                  {friend().display_name || friend().username}
                </h3>
                <p class="text-text-muted text-sm mb-4">
                  @{friend().username}
                </p>
                <p class="text-text-muted text-sm">
                  This is the beginning of your direct message history with{' '}
                  <span class="font-medium">{friend().display_name || friend().username}</span>.
                </p>
                <p class="text-xs text-status-online flex items-center gap-1 mt-2">
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Messages are end-to-end encrypted
                </p>
              </div>
            </Show>

            {/* Messages */}
            <For each={props.messages}>
              {(message) => {
                const isMe = message.sender_id === props.currentUserId;
                return (
                  <div class={`flex mb-3 ${isMe ? 'justify-end' : 'justify-start'}`}>
                    {/* Avatar for received messages */}
                    <Show when={!isMe}>
                      <div class="flex-shrink-0 mr-2">
                        <Avatar
                          src={friend().avatar_url}
                          alt={friend().display_name || friend().username}
                          size="sm"
                        />
                      </div>
                    </Show>

                    <div class={`max-w-[70%] ${isMe ? 'order-1' : ''}`}>
                      <div class={`rounded-2xl px-4 py-2 ${
                        isMe 
                          ? 'bg-brand-primary text-white rounded-br-md' 
                          : 'bg-bg-tertiary text-text-primary rounded-bl-md'
                      }`}>
                        <p class="break-words whitespace-pre-wrap">{message.content}</p>
                      </div>
                      <div class={`text-[10px] mt-1 text-text-muted ${isMe ? 'text-right' : 'text-left'}`}>
                        {formatTime(message.created_at)}
                      </div>
                    </div>

                    {/* Avatar for sent messages (own) */}
                    <Show when={isMe}>
                      <div class="flex-shrink-0 ml-2">
                        <Avatar
                          src={props.currentUserAvatar}
                          alt={props.currentUserDisplayName || "You"}
                          size="sm"
                        />
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
            <div ref={messagesEndRef} />
          </div>

          {/* Bottom Section with Bendy Line and Actions */}
          <div class="relative">
            <BendyLine variant="horizontal" direction="up" class="absolute top-0 left-0 right-0 -translate-y-1/2" />
            
            {/* Typing Indicator */}
            <Show when={props.isTyping}>
              <div class="flex items-center gap-2 text-xs text-text-muted px-4 pt-2">
                <div class="flex gap-0.5">
                  <span class="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ "animation-delay": "0ms" }} />
                  <span class="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ "animation-delay": "150ms" }} />
                  <span class="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ "animation-delay": "300ms" }} />
                </div>
                <span>{friend().display_name || friend().username} is typing...</span>
              </div>
            </Show>

            {/* Message Input */}
            <div class="p-4 flex items-end gap-3">
              <div class="flex-1 flex items-end bg-bg-tertiary rounded-lg">
                <textarea
                  ref={inputRef}
                  value={messageInput()}
                  onInput={(e) => {
                    setMessageInput(e.currentTarget.value);
                    handleTyping();
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message @${friend().username}`}
                  rows={1}
                  class="flex-1 bg-transparent py-3 px-4 text-text-primary placeholder:text-text-muted outline-none resize-none max-h-32 scrollbar-thin"
                  style={{ "min-height": "24px" }}
                />
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

              {/* Bottom Right Action Buttons */}
              <div class="flex items-center gap-2">
                <button class="w-10 h-10 bg-bg-tertiary rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover transition-colors">
                  <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
                <button class="w-10 h-10 bg-bg-tertiary rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover transition-colors">
                  <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                </button>
                <button
                  ref={gifButtonRef}
                  onClick={() => setShowGifPicker(!showGifPicker())}
                  class="w-10 h-10 bg-bg-tertiary rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover transition-colors"
                  title="Send a GIF"
                >
                  <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11.5 9H13v6h-1.5V9zM9 9H6c-.5 0-1 .5-1 1v4c0 .5.5 1 1 1h3c.5 0 1-.5 1-1v-4c0-.5-.5-1-1-1zm-.5 4.5h-2v-3h2v3zM19 10.5V9h-4.5v6H16v-2h2v-1.5h-2v-1h3z" />
                  </svg>
                </button>

                {/* GIF Picker */}
                <GifPicker
                  isOpen={showGifPicker()}
                  onClose={() => setShowGifPicker(false)}
                  onSelect={(gifUrl) => {
                    props.onSendMessage(gifUrl);
                    setShowGifPicker(false);
                  }}
                  anchorRef={gifButtonRef}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
