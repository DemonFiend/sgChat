import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { MessageContent, AttachmentCard } from '@/components/ui/MessageContent';
import { Modal } from '@/components/ui/Modal';
import { BendyLine } from '@/components/ui/BendyLine';
import { GifPicker } from '@/components/ui/GifPicker';
import { ReactionPicker } from '@/components/ui/ReactionPicker';
import { DMVoiceControls, DMCallStatusBar } from '@/components/ui/DMVoiceControls';
import { DMCallArea } from '@/components/ui/DMCallArea';
import { useVoiceStore } from '@/stores/voice';
import { dmVoiceService } from '@/lib/dmVoiceService';
import { socketService } from '@/lib/socket';
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
  sender_id: string | null;
  created_at: string;
  edited_at?: string | null;
  reply_to_id?: string | null;
  reactions?: Array<{
    emoji?: string;
    type?: 'unicode' | 'custom';
    emojiId?: string;
    shortcode?: string;
    url?: string;
    is_animated?: boolean;
    count: number;
    users?: string[];
    me: boolean;
  }>;
  attachments?: any[];
  system_event?: { type: string; user_id?: string; username?: string; timestamp?: string } | null;
}

interface DMChatPanelProps {
  friend: Friend | null;
  messages: DMMessage[];
  currentUserId: string;
  currentUserAvatar?: string | null;
  currentUserDisplayName?: string | null;
  onSendMessage: (content: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  onReplyClick?: (message: DMMessage) => void;
  onReactionAdd?: (messageId: string, emoji: string) => void;
  replyingTo?: DMMessage | null;
  onCancelReply?: () => void;
  onTypingStart?: () => void;
  onTypingStop?: () => void;
  isTyping?: boolean;
  serverId?: string;
  isPartnerBlocked?: boolean;
  onMobileBack?: () => void;
  onMobileSidebarToggle?: () => void;
}

export function DMChatPanel({
  friend,
  messages,
  currentUserId,
  currentUserAvatar,
  currentUserDisplayName,
  onSendMessage,
  onEditMessage,
  onDeleteMessage,
  onReplyClick,
  onReactionAdd,
  replyingTo,
  onCancelReply,
  onTypingStart,
  onTypingStop,
  isTyping: friendIsTyping,
  serverId,
  isPartnerBlocked,
  onMobileBack,
  onMobileSidebarToggle,
}: DMChatPanelProps) {
  const connectionState = useVoiceStore((s) => s.connectionState);
  const currentChannelId = useVoiceStore((s) => s.currentChannelId);
  const incomingDMCall = useVoiceStore((s) => s.incomingDMCall);
  const isInDMCall = connectionState === 'connected' && currentChannelId === (friend?.dm_channel_id || '');
  const [friendInCall, setFriendInCall] = useState(false);

  // Check if friend is already in a DM voice call when switching to this DM
  useEffect(() => {
    if (!friend?.dm_channel_id) { setFriendInCall(false); return; }
    setFriendInCall(false);
    api.get<{ is_active: boolean; participants: Array<{ user_id: string }> }>(
      `/dms/${friend.dm_channel_id}/voice/status`
    ).then(res => {
      const otherInCall = res.participants.some(p => p.user_id !== currentUserId);
      setFriendInCall(otherInCall);
    }).catch(() => {});
  }, [friend?.dm_channel_id, currentUserId]);

  // Listen for real-time voice join/leave to update banner
  useEffect(() => {
    if (!friend?.dm_channel_id) return;
    const handleVoiceJoin = (data: { is_dm_call?: boolean; dm_channel_id?: string; user?: { id: string } }) => {
      if (data.is_dm_call && data.dm_channel_id === friend.dm_channel_id && data.user?.id !== currentUserId) {
        setFriendInCall(true);
      }
    };
    const handleVoiceLeave = (data: { is_dm_call?: boolean; dm_channel_id?: string }) => {
      if (data.is_dm_call && data.dm_channel_id === friend.dm_channel_id) {
        setFriendInCall(false);
      }
    };
    socketService.on('voice.join', handleVoiceJoin as (data: unknown) => void);
    socketService.on('voice.leave', handleVoiceLeave as (data: unknown) => void);
    return () => {
      socketService.off('voice.join', handleVoiceJoin as (data: unknown) => void);
      socketService.off('voice.leave', handleVoiceLeave as (data: unknown) => void);
    };
  }, [friend?.dm_channel_id, currentUserId]);

  // Clear friendInCall when user joins the call
  useEffect(() => {
    if (isInDMCall) setFriendInCall(false);
  }, [isInDMCall]);

  const showIncomingCallBanner = !isInDMCall && (
    (!!incomingDMCall && incomingDMCall.dmChannelId === (friend?.dm_channel_id || '')) ||
    friendInCall
  );

  const handleJoinFromBanner = useCallback(async () => {
    const incoming = useVoiceStore.getState().incomingDMCall;
    const dmChannelId = incoming?.dmChannelId || friend?.dm_channel_id;
    const callerName = incoming?.callerName || friend?.display_name || friend?.username || '';
    if (!dmChannelId) return;

    if (incoming) {
      useVoiceStore.getState().setPendingDMCallInfo({
        friendId: incoming.callerId,
        friendName: incoming.callerName,
        dmChannelId: incoming.dmChannelId,
      });
    }
    try {
      await dmVoiceService.join(dmChannelId, callerName, true);
    } catch (err) {
      console.error('[DMChatPanel] Failed to join call from banner:', err);
    }
    useVoiceStore.getState().setIncomingDMCall(null);
    setFriendInCall(false);
  }, [friend]);

  const [messageInput, setMessageInput] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [pendingDeleteMessageId, setPendingDeleteMessageId] = useState<string | null>(null);
  const [reactionPickerMsg, setReactionPickerMsg] = useState<{ id: string; anchor: HTMLElement } | null>(null);
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
          {/* Mobile: hamburger for server list + back arrow to DM sidebar */}
          <div className="flex items-center gap-1 md:hidden flex-shrink-0">
            {onMobileSidebarToggle && (
              <button
                onClick={onMobileSidebarToggle}
                className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover transition-colors"
                title="Toggle server list"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
            {onMobileBack && (
              <button
                onClick={onMobileBack}
                className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover transition-colors"
                title="Back to conversations"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
          </div>
          {/* Friend Info */}
          <div className="flex-1 min-w-0">
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

      {/* Incoming Call Banner */}
      {showIncomingCallBanner && (
        <div className="flex items-center justify-between px-4 py-3 bg-warning/10 border-b border-warning/30">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-warning animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            <span className="text-sm font-medium text-warning">
              {incomingDMCall ? `${incomingDMCall.callerName} is calling you` : `${friend?.display_name || friend?.username} is in a call`}
            </span>
          </div>
          <button
            onClick={handleJoinFromBanner}
            className="px-4 py-1.5 bg-status-online/20 text-status-online rounded-md hover:bg-status-online/30 transition-colors text-sm font-medium"
          >
            Join Call
          </button>
        </div>
      )}

      {/* Call Area (video/screen share/audio indicator) */}
      {isInDMCall && friend && (
        <DMCallArea
          dmChannelId={friend.dm_channel_id || ''}
          friendName={friend.display_name || friend.username}
          friendAvatarUrl={friend.avatar_url}
          currentUserAvatarUrl={currentUserAvatar}
          currentUserDisplayName={currentUserDisplayName}
        />
      )}

      {/* In-Call Controls Bar */}
      {isInDMCall && friend && (
        <DMCallStatusBar
          dmChannelId={friend.dm_channel_id || ''}
          friendName={friend.display_name || friend.username}
        />
      )}

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
          // System messages (missed calls, etc.)
          if (message.system_event) {
            const isMissedCall = message.system_event.type === 'dm_call_missed' || message.system_event.type === 'dm_call_unanswered';
            return (
              <div key={message.id} className="flex items-center justify-center py-2 gap-2">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-bg-tertiary">
                  {isMissedCall ? (
                    <svg className="w-4 h-4 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                  <span className={`text-xs italic ${isMissedCall ? 'text-danger' : 'text-text-muted'}`}>
                    {message.content}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {formatTime(message.created_at)}
                  </span>
                </div>
              </div>
            );
          }

          const isMe = message.sender_id === currentUserId;
          const isEditing = editingMessageId === message.id;
          const senderName = isMe
            ? (currentUserDisplayName || 'You')
            : (friend.display_name || friend.username);
          const senderAvatar = isMe ? currentUserAvatar : friend.avatar_url;

          // Group messages from same sender within 5 minutes
          const prev = index > 0 ? messages[index - 1] : null;
          const showAuthor = !prev
            || prev.sender_id !== message.sender_id
            || new Date(message.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60 * 1000;

          // Reply indicator
          const replyToMessage = message.reply_to_id ? messages.find((m) => m.id === message.reply_to_id) : undefined;
          const replyIndicator = replyToMessage ? (
            <div className="flex items-center gap-1.5 text-xs text-text-muted mb-0.5 ml-10 truncate">
              <span className="flex-shrink-0">&#8617;</span>
              <span className="font-medium">
                @{replyToMessage.sender_id === currentUserId
                  ? (currentUserDisplayName || 'You')
                  : (friend.display_name || friend.username)}
              </span>
              <span className="truncate opacity-70">
                {replyToMessage.content.length > 80
                  ? replyToMessage.content.slice(0, 80) + '...'
                  : replyToMessage.content}
              </span>
            </div>
          ) : null;

          // Message content (editable or read-only)
          const messageBody = isEditing ? (
            <div className="mt-1">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (editContent.trim() && onEditMessage) {
                      onEditMessage(message.id, editContent.trim());
                    }
                    setEditingMessageId(null);
                    setEditContent('');
                  }
                  if (e.key === 'Escape') {
                    setEditingMessageId(null);
                    setEditContent('');
                  }
                }}
                className="w-full bg-bg-tertiary rounded p-2 text-text-primary outline-none resize-none text-sm"
                rows={2}
                autoFocus
              />
              <div className="text-xs text-text-muted mt-1">
                escape to <button onClick={() => { setEditingMessageId(null); setEditContent(''); }} className="text-text-link hover:underline">cancel</button>
                {' \u2022 '}enter to <button onClick={() => { if (editContent.trim() && onEditMessage) { onEditMessage(message.id, editContent.trim()); } setEditingMessageId(null); setEditContent(''); }} className="text-text-link hover:underline">save</button>
              </div>
            </div>
          ) : (
            <>
              <div className="text-text-primary">
                <MessageContent content={message.content} isOwnMessage={isMe} />
                {message.edited_at && (
                  <span className="text-[10px] text-text-muted ml-1" title={new Date(message.edited_at).toLocaleString()}>(edited)</span>
                )}
              </div>
              {Array.isArray(message.attachments) && message.attachments.length > 0 && (
                <div className="mt-1">
                  {message.attachments.map((att: any, idx: number) => (
                    <AttachmentCard key={idx} attachment={att} />
                  ))}
                </div>
              )}
              {/* Reactions */}
              {message.reactions && message.reactions.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {message.reactions.map((r) => {
                    const key = r.type === 'custom' ? `custom:${r.emojiId}` : `unicode:${r.emoji}`;
                    return (
                      <button
                        key={key}
                        onClick={() => onReactionAdd?.(message.id, r.emoji || '')}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                          r.me
                            ? 'bg-accent/20 border-accent text-accent'
                            : 'bg-bg-tertiary border-transparent text-text-muted hover:border-border'
                        }`}
                      >
                        {r.type === 'custom' && r.url ? (
                          <img src={r.url} alt={r.shortcode ? `:${r.shortcode}:` : 'emoji'} className="w-4 h-4 object-contain" loading="lazy" />
                        ) : (
                          <span>{r.emoji}</span>
                        )}
                        <span>{r.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          );

          // Action toolbar (hover)
          const actionToolbar = !isEditing && (
            <div className="absolute -top-3 right-4 opacity-0 group-hover:opacity-100 flex items-center gap-0.5 bg-bg-secondary rounded border border-border shadow-md p-0.5 z-10">
              {onReplyClick && (
                <button
                  className="p-1 rounded hover:bg-bg-modifier-active text-text-muted hover:text-text-primary transition-colors"
                  title="Reply"
                  onClick={() => onReplyClick(message)}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                </button>
              )}
              <button
                className="p-1 rounded hover:bg-bg-modifier-active text-text-muted hover:text-text-primary transition-colors"
                title="Add Reaction"
                onClick={(e) => setReactionPickerMsg({ id: message.id, anchor: e.currentTarget })}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
              {isMe && onEditMessage && (
                <button
                  className="p-1 rounded hover:bg-bg-modifier-active text-text-muted hover:text-text-primary transition-colors"
                  title="Edit"
                  onClick={() => { setEditingMessageId(message.id); setEditContent(message.content); }}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              )}
              {isMe && onDeleteMessage && (
                <button
                  className="p-1 rounded hover:bg-bg-modifier-active text-text-muted hover:text-danger transition-colors"
                  title="Delete"
                  onClick={() => setPendingDeleteMessageId(message.id)}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          );

          if (showAuthor) {
            return (
              <div key={message.id} className={`flex pt-4 pb-0.5 justify-start hover:bg-bg-modifier-hover group relative ${isEditing ? 'bg-bg-modifier-hover' : ''}`}>
                {actionToolbar}
                {replyIndicator}
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
                  {messageBody}
                </div>
              </div>
            );
          }

          // Compact continuation message
          return (
            <div key={message.id} className={`flex py-px justify-start hover:bg-bg-modifier-hover group relative ${isEditing ? 'bg-bg-modifier-hover' : ''}`}>
              {actionToolbar}
              {replyIndicator}
              <div className="w-8 flex-shrink-0 mr-2 flex items-start justify-end pt-0.5">
                <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100">
                  {formatTime(message.created_at)}
                </span>
              </div>
              <div className="max-w-[85%]">
                {messageBody}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Reaction Picker Portal */}
      {reactionPickerMsg && (
        <ReactionPicker
          isOpen={true}
          onClose={() => setReactionPickerMsg(null)}
          onSelect={(emoji) => {
            onReactionAdd?.(reactionPickerMsg.id, emoji);
            setReactionPickerMsg(null);
          }}
          anchorRef={reactionPickerMsg.anchor}
          serverId={serverId}
        />
      )}

      {/* Delete Message Confirmation Modal */}
      <Modal isOpen={!!pendingDeleteMessageId} onClose={() => setPendingDeleteMessageId(null)} title="Delete Message">
        <p className="text-text-secondary">Are you sure you want to delete this message?</p>
        <div className="flex justify-end gap-3 mt-4">
          <button
            className="px-4 py-2 rounded text-text-primary hover:bg-bg-modifier-hover transition-colors"
            onClick={() => setPendingDeleteMessageId(null)}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 rounded bg-danger text-white hover:bg-danger/80 transition-colors"
            onClick={() => {
              if (pendingDeleteMessageId && onDeleteMessage) {
                onDeleteMessage(pendingDeleteMessageId);
              }
              setPendingDeleteMessageId(null);
            }}
          >
            Delete
          </button>
        </div>
      </Modal>

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

        {/* Blocked User Indicator */}
        {isPartnerBlocked && (
          <div className="px-4 py-3 flex items-center justify-center gap-2 bg-bg-secondary border-t border-bg-tertiary">
            <svg className="w-5 h-5 text-danger shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            <span className="text-sm text-text-muted">You have blocked this user. You cannot send them messages.</span>
          </div>
        )}

        {/* Reply Indicator */}
        {replyingTo && (
          <div className="flex items-center gap-2 mx-4 mt-1 px-3 py-2 bg-bg-tertiary rounded-t-lg text-sm text-text-muted">
            <span>Replying to <strong className="text-text-primary">
              {replyingTo.sender_id === currentUserId
                ? (currentUserDisplayName || 'You')
                : (friend?.display_name || friend?.username)}
            </strong></span>
            <button onClick={onCancelReply} className="ml-auto text-text-muted hover:text-text-primary">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Message Input */}
        {!isPartnerBlocked && <div className="p-4 flex items-end gap-3">
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
              serverId={serverId}
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
        </div>}
      </div>
    </div>
  );
}
