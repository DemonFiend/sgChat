import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { clsx } from 'clsx';
import { Avatar } from '@/components/ui/Avatar';
import { MessageContent } from '@/components/ui/MessageContent';
import { ReactionPicker } from '@/components/ui/ReactionPicker';
import { GifPicker } from '@/components/ui/GifPicker';
import { StickerPicker } from '@/components/ui/StickerPicker';
import {
  MentionAutocomplete,
  buildAtItems,
  buildChannelItems,
  detectTrigger,
  type AutocompleteItem,
} from '@/components/ui/MentionAutocomplete';
import { useMentionContext } from '@/contexts/MentionContext';
import {
  convertMentionsToWireFormat,
  shiftMappings,
  parseTimeInput,
  type MentionMapping,
} from '@/lib/mentionUtils';
import { CommandAutocomplete } from '@/components/ui/CommandAutocomplete';
import { EmojiAutocomplete, detectEmojiTrigger } from '@/components/ui/EmojiAutocomplete';
import type { SlashCommand } from '@sgchat/shared';
import { MAX_MESSAGE_LENGTH } from '@sgchat/shared';
import { api } from '@/api';
import { useEmojiManifestStore } from '@/stores/emojiManifest';
import { useBlockedUsersStore } from '@/stores/blockedUsers';
import { useIgnoredUsersStore } from '@/stores/ignoredUsers';
import { useChatInputStore } from '@/stores/chatInput';

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

export interface Reaction {
  emoji?: string;
  type?: 'unicode' | 'custom';
  emojiId?: string;
  shortcode?: string;
  url?: string;
  is_animated?: boolean;
  count: number;
  users?: string[];
  me: boolean;
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
  pinned?: boolean;
}

export interface ChannelInfo {
  id: string;
  name: string;
  topic?: string;
  type: string;
}

export interface TypingUser {
  id: string;
  username: string;
}

interface ChatPanelProps {
  channel: ChannelInfo | null;
  messages: Message[];
  onSendMessage?: (content: string) => void;
  onReactionAdd?: (messageId: string, emoji: string, customEmojiId?: string) => void;
  onReactionClick?: (messageId: string, reaction: any) => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  onAuthorClick?: (author: MessageAuthor, rect: DOMRect) => void;
  onAuthorContextMenu?: (author: MessageAuthor, e: React.MouseEvent) => void;
  onTypingStart?: () => void;
  onTypingStop?: () => void;
  currentUserId?: string;
  typingUsers?: TypingUser[];
  replyingTo?: Message | null;
  onCancelReply?: () => void;
  onReplyClick?: (message: Message) => void;
  isMemberListOpen?: boolean;
  onToggleMemberList?: () => void;
  onPinMessage?: (messageId: string) => void;
  onUnpinMessage?: (messageId: string) => void;
  pinnedMessageIds?: Set<string>;
  isPinnedPanelOpen?: boolean;
  onTogglePinnedPanel?: () => void;
  canManageMessages?: boolean;
  onSearchOpen?: () => void;
  onClearMessages?: () => void;
  onCreateThread?: (message: Message) => void;
  threadMessageIds?: Set<string>;
  onOpenThread?: (messageId: string) => void;
  serverId?: string;
  serverBannerUrl?: string | null;
}

export function ChatPanel({
  channel, messages, onSendMessage, onReactionAdd, onReactionClick,
  onEditMessage, onDeleteMessage, onAuthorClick, onAuthorContextMenu,
  onTypingStart, onTypingStop, currentUserId, typingUsers,
  replyingTo, onCancelReply, onReplyClick,
  isMemberListOpen, onToggleMemberList,
  onPinMessage, onUnpinMessage, pinnedMessageIds, isPinnedPanelOpen, onTogglePinnedPanel,
  canManageMessages, onSearchOpen, onClearMessages,
  onCreateThread, threadMessageIds, onOpenThread,
  serverId, serverBannerUrl,
}: ChatPanelProps) {
  const [messageInput, setMessageInput] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [reactionPickerMsg, setReactionPickerMsg] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ file: File; previewUrl: string } | null>(null);
  const [pendingSpoiler, setPendingSpoiler] = useState(false);
  const [revealedMessages, setRevealedMessages] = useState<Set<string>>(new Set());
  const ignoredUserIds = useIgnoredUsersStore((s) => s.ignoredUserIds);
  const blockedUserIds = useBlockedUsersStore((s) => s.blockedUserIds);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const gifButtonRef = useRef<HTMLButtonElement>(null);
  const stickerButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  // Slash command autocomplete state
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [commandTrigger, setCommandTrigger] = useState<string | null>(null);

  // Mention autocomplete state
  const [mentionTrigger, setMentionTrigger] = useState<{
    triggerType: '@' | '#';
    triggerStart: number;
    query: string;
  } | null>(null);
  const [mentionMappings, setMentionMappings] = useState<MentionMapping[]>([]);
  const [stimePrompt, setStimePrompt] = useState(false);
  const mentionContext = useMentionContext();

  // Watch for mention injection from context menu
  const pendingMention = useChatInputStore((s) => s.pendingMention);

  useEffect(() => {
    if (!pendingMention) return;

    const textarea = inputRef.current;
    if (!textarea) {
      useChatInputStore.getState().clearPendingMention();
      return;
    }

    const mentionDisplay = `@${pendingMention.username}`;
    const mentionText = mentionDisplay + ' ';
    const start = textarea.selectionStart ?? messageInput.length;
    const currentValue = messageInput;

    // Insert mention at cursor position
    const newValue = currentValue.slice(0, start) + mentionText + currentValue.slice(start);

    // Shift existing mappings and add the new one
    const shifted = shiftMappings(mentionMappings, start, mentionText.length);
    shifted.push({
      displayText: mentionDisplay,
      wireFormat: `<@${pendingMention.userId}>`,
      startIndex: start,
    });

    setMentionMappings(shifted);
    setMessageInput(newValue);

    // Focus the textarea and set cursor position after the inserted mention
    requestAnimationFrame(() => {
      const newPos = start + mentionText.length;
      textarea.focus();
      textarea.setSelectionRange(newPos, newPos);
    });

    useChatInputStore.getState().clearPendingMention();
  }, [pendingMention]);

  // Emoji autocomplete state
  const [emojiTrigger, setEmojiTrigger] = useState<{
    triggerStart: number;
    query: string;
  } | null>(null);
  const emojiTriggerRef = useRef(emojiTrigger);
  emojiTriggerRef.current = emojiTrigger;
  const emojiManifest = useEmojiManifestStore((s) => serverId ? s.manifests.get(serverId) : undefined);
  const enabledEmojis = useMemo(() => {
    if (!emojiManifest) return [];
    const enabledPackIds = new Set(
      emojiManifest.packs.filter((p) => p.enabled !== false).map((p) => p.id),
    );
    return emojiManifest.emojis.filter((e) => enabledPackIds.has(e.pack_id));
  }, [emojiManifest]);

  const toggleRevealMessage = useCallback((messageId: string) => {
    setRevealedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);

  // Build combined overlay: emoji images + colored mention highlights
  const inputOverlay = useMemo(() => {
    if (!messageInput) return null;

    // Collect all decorated ranges
    const ranges: { start: number; end: number; type: 'emoji' | 'mention'; emoji?: typeof enabledEmojis[0] }[] = [];

    // Emoji ranges
    if (messageInput.includes(':') && enabledEmojis.length > 0) {
      const regex = /:([a-zA-Z0-9_]{2,32}):/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(messageInput)) !== null) {
        const emoji = enabledEmojis.find((e) => e.shortcode === match![1]);
        if (emoji) {
          ranges.push({ start: match.index, end: match.index + match[0].length, type: 'emoji', emoji });
        }
      }
    }

    // Mention ranges from mentionMappings
    for (const m of mentionMappings) {
      const end = m.startIndex + m.displayText.length;
      if (messageInput.slice(m.startIndex, end) === m.displayText) {
        ranges.push({ start: m.startIndex, end, type: 'mention' });
      }
    }

    if (ranges.length === 0) return null;

    ranges.sort((a, b) => a.start - b.start);

    const parts: (string | React.JSX.Element)[] = [];
    let lastIdx = 0;

    for (const range of ranges) {
      if (range.start < lastIdx) continue;
      if (range.start > lastIdx) {
        parts.push(messageInput.slice(lastIdx, range.start));
      }
      if (range.type === 'emoji' && range.emoji) {
        // Render emoji over the invisible shortcode text.
        // The invisible text preserves textarea character alignment;
        // we compress it with letter-spacing to minimize the gap around the emoji.
        const shortcode = messageInput.slice(range.start, range.end);
        parts.push(
          <span key={`inp-emoji-${range.start}`} className="relative inline-block align-bottom" style={{ letterSpacing: '-0.35em' }}>
            <span className="invisible">{shortcode}</span>
            <img
              src={range.emoji.url || range.emoji.asset_key}
              alt={shortcode}
              className="absolute left-0 top-1/2 -translate-y-1/2"
              style={{ width: '1.375em', height: '1.375em' }}
            />
          </span>
        );
      } else if (range.type === 'mention') {
        parts.push(
          <span key={`inp-mention-${range.start}`} className="text-brand-primary bg-brand-primary/15 rounded px-0.5">
            {messageInput.slice(range.start, range.end)}
          </span>
        );
      }
      lastIdx = range.end;
    }

    if (lastIdx < messageInput.length) {
      parts.push(messageInput.slice(lastIdx));
    }

    return parts;
  }, [messageInput, enabledEmojis, mentionMappings]);

  // Build autocomplete item lists from MentionContext
  const atItems = useMemo(() => {
    const memberArr = Array.from(mentionContext.members.entries()).map(([id, m]) => ({
      id,
      username: m.username,
      display_name: m.display_name,
      avatar_url: m.avatar_url,
      role_color: m.role_color,
    }));
    const roleArr = Array.from(mentionContext.roles.entries()).map(([id, r]) => ({
      id,
      name: r.name,
      color: r.color,
    }));
    return buildAtItems(memberArr, roleArr);
  }, [mentionContext.members, mentionContext.roles]);

  const channelItems = useMemo(() => {
    const channelArr = Array.from(mentionContext.channels.entries()).map(([id, c]) => ({
      id,
      name: c.name,
      type: c.type,
    }));
    return buildChannelItems(channelArr);
  }, [mentionContext.channels]);

  // Fetch slash commands once on mount
  useEffect(() => {
    let cancelled = false;
    api.get<SlashCommand[]>('/channels/commands').then((cmds) => {
      if (!cancelled) setSlashCommands(cmds);
    }).catch(() => {
      // Silently ignore — commands won't show autocomplete
    });
    return () => { cancelled = true; };
  }, []);

  // Detect slash command trigger: input starts with `/` and no spaces yet (or partial match)
  const detectCommandTrigger = useCallback((text: string): string | null => {
    if (!text.startsWith('/')) return null;
    // Only trigger when the cursor is still in the first "word" (the command name)
    const spaceIndex = text.indexOf(' ');
    if (spaceIndex !== -1) return null; // User has typed a space, command name is done
    return text.slice(1); // Return the query portion after /
  }, []);

  // Handle slash command selection from autocomplete
  const handleCommandSelect = useCallback((cmd: SlashCommand) => {
    setMessageInput(`/${cmd.name} `);
    setCommandTrigger(null);
    inputRef.current?.focus();
  }, []);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Track whether user is scrolled to bottom
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  // Virtual list for messages
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 60,
    overscan: 15,
  });

  // Auto-scroll to bottom when new messages arrive (only if already at bottom)
  useEffect(() => {
    if (messages.length > 0 && isAtBottomRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Cleanup typing timeout
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (isTypingRef.current) onTypingStop?.();
    };
  }, [onTypingStop]);

  const handleTyping = useCallback(() => {
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
  }, [onTypingStart, onTypingStop]);

  const handleSend = useCallback(() => {
    const content = messageInput.trim();
    if (content && onSendMessage && content.length <= MAX_MESSAGE_LENGTH) {
      // Handle /clear locally — never send to server
      if (content === '/clear') {
        onClearMessages?.();
        setMessageInput('');
        setCommandTrigger(null);
        inputRef.current?.focus();
        return;
      }

      if (isTypingRef.current) {
        isTypingRef.current = false;
        onTypingStop?.();
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = null;
        }
      }
      // Convert display-text mentions to wire format before sending
      const wireContent = mentionMappings.length > 0
        ? convertMentionsToWireFormat(content, mentionMappings)
        : content;
      onSendMessage(wireContent);
      setMessageInput('');
      setMentionMappings([]);
      setMentionTrigger(null);
      setCommandTrigger(null);
      setStimePrompt(false);
      // Reset textarea height after sending
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }
      inputRef.current?.focus();
    }
  }, [messageInput, onSendMessage, onTypingStop, mentionMappings, onClearMessages]);

  // Handle mention autocomplete selection
  const handleMentionSelect = useCallback((item: AutocompleteItem) => {
    if (!mentionTrigger || !inputRef.current) return;

    // @stime special flow: prompt for time input
    if (item.type === 'stime') {
      setStimePrompt(true);
      setMentionTrigger(null);
      return;
    }

    const before = messageInput.slice(0, mentionTrigger.triggerStart);
    const after = messageInput.slice(
      mentionTrigger.triggerStart + 1 + mentionTrigger.query.length,
    );
    const insertText = item.insertText + ' ';
    const newInput = before + insertText + after;

    // Update mappings — shift existing ones and add new one
    const delta = insertText.length - (1 + mentionTrigger.query.length);
    const shifted = shiftMappings(
      mentionMappings,
      mentionTrigger.triggerStart,
      delta,
    );

    // Only add mapping if wireFormat differs from insertText (not for @here/@everyone)
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

    // Restore cursor position
    const cursorPos = before.length + insertText.length;
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(cursorPos, cursorPos);
      inputRef.current?.focus();
    });
  }, [mentionTrigger, messageInput, mentionMappings]);

  // Handle emoji autocomplete selection
  const handleEmojiSelect = useCallback(
    (emoji: { shortcode: string }) => {
      const trigger = emojiTriggerRef.current;
      if (!trigger || !inputRef.current) return;

      const currentInput = inputRef.current.value;
      const before = currentInput.slice(0, trigger.triggerStart);
      const after = currentInput.slice(
        trigger.triggerStart + 1 + trigger.query.length,
      );
      const insertText = `:${emoji.shortcode}: `;
      const newInput = before + insertText + after;

      setMessageInput(newInput);
      setEmojiTrigger(null);

      const cursorPos = before.length + insertText.length;
      requestAnimationFrame(() => {
        inputRef.current?.setSelectionRange(cursorPos, cursorPos);
        inputRef.current?.focus();
      });
    },
    [],
  );

  // Handle @stime time input
  const handleStimeInput = useCallback((timeStr: string) => {
    const ts = parseTimeInput(timeStr);
    if (ts === null) return;

    const serverTz = mentionContext.serverTimezone || 'UTC';
    const date = new Date(ts * 1000);
    const displayTime = date.toLocaleTimeString('en-US', {
      timeZone: serverTz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const displayText = `${displayTime} Server Time`;
    const wireFormat = `<t:${ts}>`;

    const cursorPos = inputRef.current?.selectionStart ?? messageInput.length;
    const before = messageInput.slice(0, cursorPos);
    const after = messageInput.slice(cursorPos);
    const newInput = before + displayText + ' ' + after;

    const newMapping: MentionMapping = {
      displayText,
      wireFormat,
      startIndex: cursorPos,
    };

    setMentionMappings((prev) => [...prev, newMapping]);
    setMessageInput(newInput);
    setStimePrompt(false);

    requestAnimationFrame(() => {
      const newCursor = cursorPos + displayText.length + 1;
      inputRef.current?.setSelectionRange(newCursor, newCursor);
      inputRef.current?.focus();
    });
  }, [messageInput, mentionContext.serverTimezone]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Let command autocomplete handle keys when open
    if (commandTrigger !== null) {
      const cmdHandler = (CommandAutocomplete as any)._handleKeyDown;
      if (cmdHandler && cmdHandler(e)) return;
    }

    // Let mention autocomplete handle keys when open
    if (mentionTrigger) {
      const handler = (MentionAutocomplete as any)._handleKeyDown;
      if (handler && handler(e)) return;
    }

    // Let emoji autocomplete handle keys when open
    if (emojiTrigger) {
      const emojiHandler = (EmojiAutocomplete as any)._handleKeyDown;
      if (emojiHandler && emojiHandler(e)) return;
    }

    // @stime prompt: Enter submits the time
    if (stimePrompt && e.key === 'Escape') {
      e.preventDefault();
      setStimePrompt(false);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend, mentionTrigger, stimePrompt, commandTrigger, emojiTrigger]);

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
      onSendMessage?.(result.url);
      setMessageInput('');
      setMentionMappings([]);
      inputRef.current?.focus();
    } catch (err) {
      console.error('Text file upload failed:', err);
    } finally {
      setIsUploading(false);
    }
  }, [messageInput, onSendMessage]);

  const handleFileUpload = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*,audio/*,.pdf,.txt,.zip';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      // For image files, show preview with spoiler option
      if (file.type.startsWith('image/')) {
        const previewUrl = URL.createObjectURL(file);
        setPendingFile({ file, previewUrl });
        setPendingSpoiler(false);
        return;
      }
      // Non-image files: upload immediately
      setIsUploading(true);
      api.upload<{ url: string }>('/upload', file)
        .then((result) => onSendMessage?.(result.url))
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
      onSendMessage?.(content);
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

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const isSystemMessage = (message: Message) =>
    message.type === 'system' || message.system_event != null;

  const shouldShowAuthor = (message: Message, index: number) => {
    if (isSystemMessage(message)) return true;
    if (index === 0) return true;
    const prev = messages[index - 1];
    if (!prev?.author?.id || !message?.author?.id) return true;
    if (isSystemMessage(prev)) return true;
    if (prev.author.id !== message.author.id) return true;
    return new Date(message.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60 * 1000;
  };

  return (
    <div className="flex flex-col h-full flex-1 min-w-0 bg-bg-primary">
      {/* Channel Header */}
      <header
        className={clsx(
          'relative px-4 flex items-center gap-3 border-b border-bg-tertiary shadow-sm flex-shrink-0 bg-cover bg-center',
          serverBannerUrl ? 'h-24' : 'h-12 bg-bg-primary'
        )}
        style={serverBannerUrl ? { backgroundImage: `url(${serverBannerUrl})` } : undefined}
      >
        {serverBannerUrl && (
          <div className="absolute inset-0 bg-gradient-to-r from-bg-primary/85 via-bg-primary/60 to-bg-primary/40" />
        )}
        <div className="relative z-10 flex items-center gap-2">
          <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
          </svg>
          <span className="font-semibold text-text-primary">
            {channel?.name || 'Select a channel'}
          </span>
        </div>
        {channel?.topic && (
          <>
            <div className="relative z-10 h-6 w-px bg-border-subtle" />
            <span className="relative z-10 text-sm text-text-muted truncate">{channel.topic}</span>
          </>
        )}

        <div className="flex-1 min-w-0" />

        <div className="relative z-10 flex items-center">
          {onSearchOpen && (
            <button
              onClick={onSearchOpen}
              className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover transition-colors"
              title="Search messages (Ctrl+F)"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          )}

          {onTogglePinnedPanel && (
            <button
              onClick={onTogglePinnedPanel}
              className={clsx(
                'p-2 rounded hover:bg-bg-modifier-hover transition-colors',
                isPinnedPanelOpen ? 'text-text-primary' : 'text-text-muted'
              )}
              title={isPinnedPanelOpen ? 'Hide pinned messages' : 'Show pinned messages'}
            >
              <svg className="w-5 h-5" fill={isPinnedPanelOpen ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v3a2 2 0 01-1 1.73V14l1 1v1H5v-1l1-1V9.73A2 2 0 015 8V5zm7 14v3" />
              </svg>
            </button>
          )}

          {onToggleMemberList && (
            <button
              onClick={onToggleMemberList}
              className={clsx(
                'p-2 rounded hover:bg-bg-modifier-hover transition-colors',
                isMemberListOpen ? 'text-text-primary' : 'text-text-muted'
              )}
              title={isMemberListOpen ? 'Hide member list' : 'Show member list'}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Messages Area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto scrollbar-thin"
        onScroll={handleScroll}
        role="log"
        aria-label={channel ? `Messages in ${channel.name}` : 'Messages'}
      >
        {channel ? (
          <div className="py-4">
            {/* Welcome message */}
            <div className="px-4 pb-6 mb-4 border-b border-bg-tertiary">
              <div className="w-16 h-16 rounded-full bg-bg-tertiary flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-text-primary mb-1">
                Welcome to #{channel.name}!
              </h2>
              <p className="text-text-muted">
                This is the start of the #{channel.name} channel.
                {channel.topic && ` ${channel.topic}`}
              </p>
            </div>

            {/* Virtualized Messages */}
            <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const message = messages[virtualRow.index];
                const isEditing = editingMessageId === message.id;
                const authorId = message.author?.id;
                const isBlocked = authorId ? blockedUserIds.has(authorId) : false;
                const isIgnored = authorId ? ignoredUserIds.has(authorId) : false;
                const isRevealed = revealedMessages.has(message.id);

                const messageElement = (
                    <MemoizedMessageItem
                      message={message}
                      showAuthor={shouldShowAuthor(message, virtualRow.index)}
                      formatTime={formatTime}
                      onReactionClick={onReactionClick ? (reaction: any) => onReactionClick(message.id, reaction) : undefined}
                      onReactionAdd={onReactionAdd ? (emoji: string) => onReactionAdd(message.id, emoji) : undefined}
                      currentUserId={currentUserId}
                      serverId={serverId}
                      isEditing={isEditing}
                      editContent={isEditing ? editContent : ''}
                      onEditChange={setEditContent}
                      onEditSave={() => {
                        if (editContent.trim() && onEditMessage) {
                          onEditMessage(message.id, editContent.trim());
                        }
                        setEditingMessageId(null);
                        setEditContent('');
                      }}
                      onEditCancel={() => { setEditingMessageId(null); setEditContent(''); }}
                      onEditStart={() => { setEditingMessageId(message.id); setEditContent(message.content); }}
                      onDeleteClick={onDeleteMessage ? () => onDeleteMessage(message.id) : undefined}
                      onReactClick={(anchor: HTMLElement) => setReactionPickerMsg({ id: message.id, anchor })}
                      onAuthorClick={onAuthorClick}
                      onAuthorContextMenu={onAuthorContextMenu}
                      onReplyClick={onReplyClick ? () => onReplyClick(message) : undefined}
                      isPinned={pinnedMessageIds?.has(message.id)}
                      canPin={canManageMessages}
                      onPinClick={() => {
                        if (pinnedMessageIds?.has(message.id)) {
                          onUnpinMessage?.(message.id);
                        } else {
                          onPinMessage?.(message.id);
                        }
                      }}
                      onCreateThread={onCreateThread ? () => onCreateThread(message) : undefined}
                      hasThread={threadMessageIds?.has(message.id)}
                      onOpenThread={onOpenThread ? () => onOpenThread(message.id) : undefined}
                    />
                );

                return (
                  <div
                    key={message.id}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {isBlocked ? (
                      <div
                        className="px-4 py-1.5 text-xs text-text-muted italic cursor-pointer hover:bg-bg-modifier-hover transition-colors"
                        onClick={() => toggleRevealMessage(message.id)}
                      >
                        {isRevealed ? (
                          <div className="not-italic">
                            <span className="text-text-muted font-medium">[Blocked User]</span>
                            {' '}
                            <span className="text-text-secondary">{message.content}</span>
                          </div>
                        ) : (
                          'Blocked message \u2014 click to reveal'
                        )}
                      </div>
                    ) : isIgnored ? (
                      <div
                        className="relative cursor-pointer group"
                        onClick={() => toggleRevealMessage(message.id)}
                      >
                        <div className={clsx(
                          'transition-all duration-200',
                          !isRevealed && 'blur-sm select-none pointer-events-none'
                        )}>
                          {messageElement}
                        </div>
                        {!isRevealed && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-xs text-text-muted bg-bg-primary/80 px-3 py-1 rounded-full">
                              Message from ignored user \u2014 click to reveal
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      messageElement
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center h-full">
            <div className="text-center">
              <svg className="w-16 h-16 mx-auto mb-4 text-text-muted opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-text-muted">Select a channel to start chatting</p>
            </div>
          </div>
        )}
      </div>

      {/* Reaction Picker Portal */}
      {reactionPickerMsg && (
        <ReactionPicker
          isOpen={true}
          onClose={() => setReactionPickerMsg(null)}
          onSelect={(emoji, customEmojiId) => {
            onReactionAdd?.(reactionPickerMsg.id, emoji, customEmojiId);
            setReactionPickerMsg(null);
          }}
          anchorRef={reactionPickerMsg.anchor}
          serverId={serverId}
        />
      )}

      {/* Message Input */}
      {channel && (
        <div className="px-4 pb-4 flex-shrink-0">
          {/* Reply Indicator */}
          {replyingTo && (
            <div className="flex items-center gap-2 px-3 py-2 mb-1 bg-bg-tertiary rounded-t-lg text-sm text-text-muted">
              <span>Replying to <strong className="text-text-primary">{replyingTo.author.display_name || replyingTo.author.username}</strong></span>
              <button onClick={onCancelReply} className="ml-auto text-text-muted hover:text-text-primary">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Pending File Preview */}
          {pendingFile && (
            <div className="flex items-center gap-3 px-3 py-2 mb-1 bg-bg-tertiary rounded-lg border border-border-subtle">
              <img
                src={pendingFile.previewUrl}
                alt="Upload preview"
                className={clsx(
                  'w-16 h-16 object-cover rounded',
                  pendingSpoiler && 'blur-[20px] brightness-50',
                )}
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

          {/* Typing Indicator */}
          {typingUsers && typingUsers.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-text-muted px-2 pb-1" aria-live="polite">
              <div className="flex gap-0.5">
                <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span>
                {typingUsers.length === 1
                  ? `${typingUsers[0].username} is typing...`
                  : typingUsers.length === 2
                    ? `${typingUsers[0].username} and ${typingUsers[1].username} are typing...`
                    : typingUsers.length <= 4
                      ? `${typingUsers.slice(0, -1).map((u) => u.username).join(', ')} and ${typingUsers[typingUsers.length - 1].username} are typing...`
                      : 'Several people are typing...'}
              </span>
            </div>
          )}

          {/* Slash Command Autocomplete */}
          <div className="relative">
            {commandTrigger !== null && slashCommands.length > 0 && (
              <CommandAutocomplete
                query={commandTrigger}
                commands={slashCommands}
                onSelect={handleCommandSelect}
                onClose={() => setCommandTrigger(null)}
              />
            )}
          </div>

          {/* Mention Autocomplete */}
          <div className="relative">
            {mentionTrigger && (
              <MentionAutocomplete
                query={mentionTrigger.query}
                triggerType={mentionTrigger.triggerType}
                items={mentionTrigger.triggerType === '@' ? atItems : channelItems}
                onSelect={handleMentionSelect}
                onClose={() => setMentionTrigger(null)}
              />
            )}
          </div>

          {/* Emoji Autocomplete */}
          <div className="relative">
            {emojiTrigger && enabledEmojis.length > 0 && (
              <EmojiAutocomplete
                query={emojiTrigger.query}
                emojis={enabledEmojis}
                onSelect={handleEmojiSelect}
                onClose={() => setEmojiTrigger(null)}
              />
            )}
          </div>

          {/* @stime Time Input Prompt */}
          {stimePrompt && (
            <div className="flex items-center gap-2 px-3 py-2 mb-1 bg-brand-primary/10 border border-brand-primary/20 rounded-lg text-sm">
              <svg className="w-4 h-4 text-brand-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-text-muted">Enter your local time:</span>
              <input
                type="text"
                name="local-time"
                placeholder="e.g. 3pm, 15:00, 3:30 PM"
                className="flex-1 bg-transparent text-text-primary outline-none text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleStimeInput((e.target as HTMLInputElement).value);
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setStimePrompt(false);
                    inputRef.current?.focus();
                  }
                }}
              />
              <button
                onClick={() => { setStimePrompt(false); inputRef.current?.focus(); }}
                className="text-text-muted hover:text-text-primary"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          <div className="flex items-end bg-bg-tertiary rounded-lg">
            {/* Attach button */}
            <button
              onClick={handleFileUpload}
              disabled={isUploading}
              className="p-3 text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
              title="Upload a file"
            >
              {isUploading ? (
                <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
              )}
            </button>

            {/* Text input with emoji overlay */}
            <div className="flex-1 relative">
              {/* Mirror overlay — renders emojis inline over transparent textarea text */}
              {inputOverlay && (
                <div
                  className="absolute inset-0 py-3 px-2 pointer-events-none whitespace-pre-wrap break-words overflow-hidden text-text-primary"
                  style={{ minHeight: '24px', fontSize: 'inherit', lineHeight: 'inherit', fontFamily: 'inherit' }}
                  aria-hidden="true"
                >
                  {inputOverlay}
                </div>
              )}
              <textarea
                ref={inputRef}
                value={messageInput}
                onChange={(e) => {
                  const newValue = e.target.value;
                  const cursorPos = e.target.selectionStart ?? newValue.length;
                  setMessageInput(newValue);
                  handleTyping();

                  // Auto-resize textarea to fit content
                  const el = e.target;
                  el.style.height = 'auto';
                  el.style.height = `${Math.min(el.scrollHeight, 192)}px`;

                  // Detect slash command trigger
                  const cmdTrigger = detectCommandTrigger(newValue);
                  setCommandTrigger(cmdTrigger);

                  // Detect mention trigger (only if no command trigger)
                  const trigger = cmdTrigger === null ? detectTrigger(newValue, cursorPos) : null;
                  setMentionTrigger(trigger);

                  // Detect emoji trigger (only if no other triggers active)
                  const eTrigger =
                    cmdTrigger === null && !trigger
                      ? detectEmojiTrigger(newValue, cursorPos)
                      : null;
                  setEmojiTrigger(eTrigger);
                }}
                onKeyDown={handleKeyDown}
                placeholder={`Message #${channel.name || 'channel'}`}
                aria-label={`Message ${channel.name || 'channel'}`}
                rows={1}
                className="flex-1 w-full bg-transparent py-3 px-2 placeholder:text-text-muted outline-none resize-none max-h-48 scrollbar-thin"
                style={{
                  minHeight: '24px',
                  color: inputOverlay ? 'transparent' : undefined,
                  caretColor: 'var(--color-text-primary)',
                }}
              />
            </div>

            {/* Emoji picker button */}
            <button
              ref={emojiButtonRef}
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className={clsx(
                'p-3 transition-colors',
                showEmojiPicker ? 'text-brand-primary' : 'text-text-muted hover:text-text-primary',
              )}
              title="Emoji"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>

            {/* GIF picker button */}
            <button
              ref={gifButtonRef}
              onClick={() => setShowGifPicker(!showGifPicker)}
              className={clsx(
                'p-3 transition-colors',
                showGifPicker ? 'text-brand-primary' : 'text-text-muted hover:text-text-primary',
              )}
              title="Send a GIF"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.5 9H13v6h-1.5V9zM9 9H6c-.5 0-1 .5-1 1v4c0 .5.5 1 1 1h3c.5 0 1-.5 1-1v-4c0-.5-.5-1-1-1zm-.5 4.5h-2v-3h2v3zM19 10.5V9h-4.5v6H16v-2h2v-1.5h-2v-1h3z" />
              </svg>
            </button>

            {/* Sticker picker button */}
            {serverId && (
              <button
                ref={stickerButtonRef}
                onClick={() => setShowStickerPicker(!showStickerPicker)}
                className={clsx(
                  'p-3 transition-colors',
                  showStickerPicker ? 'text-brand-primary' : 'text-text-muted hover:text-text-primary',
                )}
                title="Send a sticker"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
            )}

            {/* Character counter */}
            {charCountVisible && (
              <span className={`px-2 text-xs font-mono select-none whitespace-nowrap ${
                isOverLimit ? 'text-red-400' : messageInput.length > MAX_MESSAGE_LENGTH * 0.9 ? 'text-yellow-400' : 'text-text-muted'
              }`}>
                {messageInput.length}/{MAX_MESSAGE_LENGTH}
              </span>
            )}

            {/* Send button */}
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

          {/* Emoji Picker Portal */}
          <ReactionPicker
            isOpen={showEmojiPicker}
            onClose={() => setShowEmojiPicker(false)}
            onSelect={(emoji) => {
              setMessageInput((prev) => prev + emoji);
              setShowEmojiPicker(false);
              inputRef.current?.focus();
            }}
            anchorRef={emojiButtonRef.current}
            serverId={serverId}
          />

          {/* GIF Picker Portal */}
          <GifPicker
            isOpen={showGifPicker}
            onClose={() => setShowGifPicker(false)}
            onSelect={(gifUrl) => {
              onSendMessage?.(gifUrl);
              setShowGifPicker(false);
            }}
            anchorRef={gifButtonRef.current}
          />

          {/* Sticker Picker Portal */}
          {serverId && (
            <StickerPicker
              isOpen={showStickerPicker}
              onClose={() => setShowStickerPicker(false)}
              onSelect={(sticker) => {
                onSendMessage?.(sticker.file_url);
                setShowStickerPicker(false);
              }}
              anchorRef={stickerButtonRef.current}
              serverId={serverId}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface MessageItemProps {
  message: Message;
  showAuthor: boolean;
  formatTime: (date: string) => string;
  onReactionClick?: (reaction: any) => void;
  onReactionAdd?: (emoji: string) => void;
  currentUserId?: string;
  serverId?: string;
  isEditing?: boolean;
  editContent?: string;
  onEditChange?: (content: string) => void;
  onEditSave?: () => void;
  onEditCancel?: () => void;
  onEditStart?: () => void;
  onDeleteClick?: () => void;
  onReactClick?: (anchor: HTMLElement) => void;
  onAuthorClick?: (author: MessageAuthor, rect: DOMRect) => void;
  onAuthorContextMenu?: (author: MessageAuthor, e: React.MouseEvent) => void;
  onReplyClick?: () => void;
  isPinned?: boolean;
  canPin?: boolean;
  onPinClick?: () => void;
  onCreateThread?: () => void;
  hasThread?: boolean;
  onOpenThread?: () => void;
}

const MemoizedMessageItem = memo(MessageItem, (prev, next) => {
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.edited_at === next.message.edited_at &&
    prev.message.reactions === next.message.reactions &&
    prev.showAuthor === next.showAuthor &&
    prev.isEditing === next.isEditing &&
    prev.editContent === next.editContent &&
    prev.isPinned === next.isPinned &&
    prev.canPin === next.canPin &&
    prev.hasThread === next.hasThread
  );
});

function MessageActionToolbar({
  isOwnMessage,
  isPinned,
  canPin,
  onReactClick,
  onEditStart,
  onDeleteClick,
  onReplyClick,
  onPinClick,
  onCreateThread,
}: {
  isOwnMessage: boolean;
  isPinned?: boolean;
  canPin?: boolean;
  onReactClick?: (anchor: HTMLElement) => void;
  onEditStart?: () => void;
  onDeleteClick?: () => void;
  onReplyClick?: () => void;
  onPinClick?: () => void;
  onCreateThread?: () => void;
}) {
  const btnClass = 'p-1 rounded hover:bg-bg-modifier-active text-text-muted hover:text-text-primary transition-colors';
  return (
    <div className="absolute -top-3 right-4 opacity-0 group-hover:opacity-100 flex items-center gap-0.5 bg-bg-secondary rounded border border-border shadow-md p-0.5 z-10">
      <button className={btnClass} title="Reply" onClick={onReplyClick}>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
        </svg>
      </button>
      {onCreateThread && (
        <button className={btnClass} title="Create Thread" onClick={onCreateThread}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
        </button>
      )}
      <button
        className={btnClass}
        title="Add Reaction"
        onClick={(e) => onReactClick?.(e.currentTarget)}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
      {canPin && (
        <button
          className={clsx(btnClass, isPinned && 'text-brand-primary')}
          title={isPinned ? 'Unpin Message' : 'Pin Message'}
          onClick={onPinClick}
        >
          <svg className="w-4 h-4" fill={isPinned ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v3a2 2 0 01-1 1.73V14l1 1v1H5v-1l1-1V9.73A2 2 0 015 8V5zm7 14v3" />
          </svg>
        </button>
      )}
      {isOwnMessage && (
        <button className={btnClass} title="Edit" onClick={onEditStart}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
      )}
      {(isOwnMessage || onDeleteClick) && (
        <button className={clsx(btnClass, 'hover:text-danger')} title="Delete" onClick={onDeleteClick}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
    </div>
  );
}

function MessageItem({
  message, showAuthor, formatTime, onReactionClick, onReactionAdd, currentUserId, serverId,
  isEditing, editContent, onEditChange, onEditSave, onEditCancel, onEditStart,
  onDeleteClick, onReactClick, onAuthorClick, onAuthorContextMenu, onReplyClick,
  isPinned, canPin, onPinClick,
  onCreateThread, hasThread, onOpenThread,
}: MessageItemProps) {
  const isSystem = message.type === 'system' || message.system_event != null;
  const author = message.author || { id: 'unknown', username: 'Unknown User', display_name: null, avatar_url: null };
  const displayName = author.display_name || author.username;
  const isOwnMessage = currentUserId === author.id;

  const handleReactionClick = (reaction: any) => {
    if (onReactionClick) {
      onReactionClick(reaction);
    } else {
      // Legacy fallback using onReactionAdd
      const emoji = reaction.emoji || reaction;
      if (typeof emoji === 'string') {
        onReactionAdd?.(emoji);
      }
    }
  };

  const handleAuthorClick = (e: React.MouseEvent) => {
    if (onAuthorClick && author.id !== 'system') {
      onAuthorClick(author, (e.currentTarget as HTMLElement).getBoundingClientRect());
    }
  };

  const handleAuthorContextMenu = (e: React.MouseEvent) => {
    if (onAuthorContextMenu && author.id !== 'system') {
      e.preventDefault();
      onAuthorContextMenu(author, e);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEditSave?.(); }
    if (e.key === 'Escape') onEditCancel?.();
  };

  const renderReactions = () => {
    if (!message.reactions || message.reactions.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {message.reactions.map((r) => {
          const isCustom = r.type === 'custom' || !!(r as any).emojiId;
          const key = isCustom
            ? `custom:${(r as any).emojiId}`
            : `unicode:${r.emoji}`;
          return (
            <button
              key={key}
              onClick={() => handleReactionClick(r)}
              className={clsx(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors',
                r.me
                  ? 'bg-accent/20 border-accent text-accent'
                  : 'bg-bg-tertiary border-transparent text-text-muted hover:border-border'
              )}
            >
              {isCustom ? (
                (r as any).url ? (
                  <img
                    src={(r as any).url}
                    alt={(r as any).shortcode ? `:${(r as any).shortcode}:` : 'emoji'}
                    className="w-4 h-4 object-contain"
                    loading="lazy"
                  />
                ) : (
                  <span className="w-4 h-4 bg-bg-modifier-hover rounded flex items-center justify-center text-[10px]">?</span>
                )
              ) : (
                <span>{r.emoji}</span>
              )}
              <span>{r.count}</span>
            </button>
          );
        })}
      </div>
    );
  };

  const renderContent = () => {
    if (isEditing) {
      return (
        <div className="mt-1">
          <textarea
            value={editContent}
            onChange={(e) => onEditChange?.(e.target.value)}
            onKeyDown={handleEditKeyDown}
            className="w-full bg-bg-tertiary rounded p-2 text-text-primary outline-none resize-none text-sm"
            rows={2}
            autoFocus
          />
          <div className="text-xs text-text-muted mt-1">
            escape to <button onClick={onEditCancel} className="text-text-link hover:underline">cancel</button>
            {' \u2022 '}enter to <button onClick={onEditSave} className="text-text-link hover:underline">save</button>
          </div>
        </div>
      );
    }
    return (
      <>
        <div className="text-text-primary">
          {(message as any).is_tts && (
            <span className="inline-flex items-center text-[10px] font-semibold text-accent-primary bg-accent-primary/10 rounded px-1 py-0.5 mr-1 align-middle" title="Text-to-Speech message">TTS</span>
          )}
          <MessageContent content={message.content} serverId={serverId} />
          {message.edited_at && (
            <span className="text-[10px] text-text-muted ml-1" title={new Date(message.edited_at).toLocaleString()}>(edited)</span>
          )}
        </div>
        {renderReactions()}
      </>
    );
  };

  // System message
  if (isSystem) {
    const eventType = message.system_event?.type;

    return (
      <div className="px-4 py-2 flex items-center gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-bg-tertiary flex items-center justify-center">
          {eventType === 'member_join' ? (
            <svg className="w-5 h-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          ) : eventType === 'member_leave' ? (
            <svg className="w-5 h-5 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" />
            </svg>
          ) : eventType === 'event_start' ? (
            <svg className="w-5 h-5 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-text-muted italic">System</span>
            <span className="text-xs text-text-muted">{formatTime(message.created_at)}</span>
          </div>
          <p className="text-sm text-text-muted italic">{message.content}</p>
        </div>
      </div>
    );
  }

  // Full message with avatar (first in group — extra top margin for separation)
  if (showAuthor) {
    return (
      <div className={clsx('px-4 pt-4 pb-1 hover:bg-bg-modifier-hover group relative', isEditing && 'bg-bg-modifier-hover')}>
        <MessageActionToolbar
          isOwnMessage={isOwnMessage}
          isPinned={isPinned}
          canPin={canPin}
          onReactClick={onReactClick}
          onEditStart={onEditStart}
          onDeleteClick={isOwnMessage ? onDeleteClick : undefined}
          onReplyClick={onReplyClick}
          onPinClick={onPinClick}
          onCreateThread={!hasThread ? onCreateThread : undefined}
        />
        <div className="flex gap-4">
          <div className="flex-shrink-0 pt-0.5">
            <Avatar src={author.avatar_url} alt={displayName} size="md" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span
                className="font-medium hover:underline cursor-pointer"
                style={{ color: author.role_color || 'var(--color-text-primary)' }}
                onClick={handleAuthorClick}
                onContextMenu={handleAuthorContextMenu}
              >
                {displayName}
              </span>
              <span className="text-xs text-text-muted">{formatTime(message.created_at)}</span>
              {isPinned && (
                <span className="text-text-muted ml-1" title="Pinned message">
                  <svg className="w-3 h-3 inline" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v3a2 2 0 01-1 1.73V14l1 1v1H5v-1l1-1V9.73A2 2 0 015 8V5zm7 14v3" />
                  </svg>
                </span>
              )}
            </div>
            {renderContent()}
            {hasThread && (
              <button
                onClick={onOpenThread}
                className="flex items-center gap-1.5 mt-1 text-xs text-brand-primary hover:underline cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                View Thread
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Compact message (continuation)
  return (
    <div className={clsx('px-4 py-px hover:bg-bg-modifier-hover group relative', isEditing && 'bg-bg-modifier-hover')}>
      <MessageActionToolbar
        isOwnMessage={isOwnMessage}
        onReactClick={onReactClick}
        onEditStart={onEditStart}
        onDeleteClick={isOwnMessage ? onDeleteClick : undefined}
        onReplyClick={onReplyClick}
        onCreateThread={!hasThread ? onCreateThread : undefined}
      />
      <div className="flex gap-4">
        <div className="w-10 flex-shrink-0 flex items-start justify-end pt-0.5">
          <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100">
            {formatTime(message.created_at)}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          {renderContent()}
          {hasThread && (
            <button
              onClick={onOpenThread}
              className="flex items-center gap-1.5 mt-1 text-xs text-brand-primary hover:underline cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
              View Thread
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
