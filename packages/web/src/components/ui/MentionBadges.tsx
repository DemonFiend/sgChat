import { useState, useEffect } from 'react';
import { useMentionContext } from '@/contexts/MentionContext';
import { api } from '@/api';
import type { ParsedMention, ParsedMessageLink } from '@sgchat/shared';

/** @user mention — blue pill, clickable opens profile */
export function UserMentionBadge({ mention }: { mention: ParsedMention }) {
  const { members, currentUserId, onUserClick } = useMentionContext();
  const member = mention.id ? members.get(mention.id) : null;
  const display = member ? `@${member.display_name || member.username}` : '@Unknown User';
  const isMe = mention.id === currentUserId;

  return (
    <span
      className={`inline-flex items-center px-1 rounded font-medium cursor-pointer transition-colors ${
        isMe
          ? 'bg-brand-primary/30 text-brand-primary hover:bg-brand-primary/40'
          : 'bg-brand-primary/20 text-brand-primary hover:bg-brand-primary/30'
      }`}
      onClick={(e) => {
        if (mention.id && onUserClick) {
          onUserClick(mention.id, (e.currentTarget as HTMLElement).getBoundingClientRect());
        }
      }}
    >
      {display}
    </span>
  );
}

/** #channel mention — blue pill, clickable navigates */
export function ChannelMentionBadge({ mention }: { mention: ParsedMention }) {
  const { channels, onChannelClick } = useMentionContext();
  const channel = mention.id ? channels.get(mention.id) : null;
  const display = channel ? `#${channel.name}` : '#unknown-channel';

  return (
    <span
      className="inline-flex items-center px-1 rounded bg-brand-primary/20 text-brand-primary font-medium cursor-pointer hover:bg-brand-primary/30 transition-colors"
      onClick={() => mention.id && onChannelClick?.(mention.id)}
    >
      {display}
    </span>
  );
}

/** @role mention — colored pill with role color */
export function RoleMentionBadge({ mention }: { mention: ParsedMention }) {
  const { roles } = useMentionContext();
  const role = mention.id ? roles.get(mention.id) : null;
  const color = role?.color || '#99aab5';
  const display = role ? `@${role.name}` : '@Unknown Role';

  return (
    <span
      className="inline-flex items-center px-1 rounded font-medium"
      style={{ backgroundColor: `${color}20`, color }}
    >
      {display}
    </span>
  );
}

/** @here / @everyone — yellow/warning pill */
export function BroadcastMentionBadge({ type }: { type: 'here' | 'everyone' }) {
  return (
    <span className="inline-flex items-center px-1 rounded bg-warning/20 text-warning font-medium">
      @{type}
    </span>
  );
}

/** <t:unix> — shows server time + viewer's local time */
export function TimeMentionBadge({ mention }: { mention: ParsedMention }) {
  const { serverTimezone } = useMentionContext();
  if (!mention.timestamp) return <span>{mention.raw}</span>;

  const date = new Date(mention.timestamp * 1000);

  const serverTime = serverTimezone
    ? date.toLocaleTimeString('en-US', {
        timeZone: serverTimezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const localTime = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-brand-primary/15 text-brand-primary text-sm"
      title={date.toLocaleString()}
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      {serverTime} Server Time
      <span className="text-text-muted">(Local: {localTime})</span>
    </span>
  );
}

/** <motd> — clickable badge with megaphone icon */
export function MOTDBadge() {
  const { onMOTDClick } = useMentionContext();

  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/20 text-accent font-medium cursor-pointer hover:bg-accent/30 transition-colors"
      onClick={onMOTDClick}
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
        />
      </svg>
      MOTD
    </span>
  );
}

/** Message link embed — fetches preview and renders inline card */
interface MessagePreview {
  id: string;
  channel_id?: string;
  dm_channel_id?: string;
  channel_name?: string;
  content_preview: string;
  author: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
  } | null;
  created_at: string;
}

const previewCache = new Map<string, MessagePreview | 'no_permission' | 'error'>();

export function MessageLinkEmbed({ link }: { link: ParsedMessageLink }) {
  const [preview, setPreview] = useState<MessagePreview | 'no_permission' | 'error' | null>(
    () => previewCache.get(link.messageId) ?? null,
  );

  useEffect(() => {
    if (preview !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<MessagePreview>(`/messages/${link.messageId}/preview`);
        if (!cancelled) {
          previewCache.set(link.messageId, data);
          setPreview(data);
        }
      } catch (err: any) {
        const result = err?.status === 403 ? 'no_permission' : 'error';
        if (!cancelled) {
          previewCache.set(link.messageId, result as 'no_permission' | 'error');
          setPreview(result);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [link.messageId, preview]);

  if (preview === null) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 bg-bg-tertiary rounded text-xs text-text-muted animate-pulse">
        Loading message preview...
      </span>
    );
  }

  if (preview === 'no_permission') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 bg-danger/10 border border-danger/20 rounded text-xs text-danger">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
        You do not have permission to view that channel
      </span>
    );
  }

  if (preview === 'error') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 bg-bg-tertiary rounded text-xs text-text-muted">
        Unable to load message preview
      </span>
    );
  }

  const time = new Date(preview.created_at).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="my-1 border-l-2 border-brand-primary pl-3 py-1 bg-bg-tertiary/50 rounded-r max-w-md">
      <div className="flex items-center gap-1.5 text-xs text-text-muted mb-0.5">
        {preview.channel_name && (
          <span className="text-brand-primary font-medium">#{preview.channel_name}</span>
        )}
        <span>{time}</span>
      </div>
      {preview.author && (
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-sm font-medium text-text-primary">
            {preview.author.display_name || preview.author.username}
          </span>
        </div>
      )}
      <p className="text-sm text-text-secondary line-clamp-2">{preview.content_preview}</p>
    </div>
  );
}
