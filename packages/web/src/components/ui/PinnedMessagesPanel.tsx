import { useCallback } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { MessageContent } from '@/components/ui/MessageContent';

interface PinnedMessage {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  };
  created_at: string;
  edited_at: string | null;
  attachments: any[];
  pinned_at: string;
  pinned_by: {
    id: string;
    username: string;
  };
}

interface PinnedMessagesPanelProps {
  channelName: string;
  pinnedMessages: PinnedMessage[];
  onUnpin?: (messageId: string) => void;
  canManageMessages?: boolean;
}

export type { PinnedMessage };

export function PinnedMessagesPanel({
  channelName,
  pinnedMessages,
  onUnpin,
  canManageMessages,
}: PinnedMessagesPanelProps) {
  const formatDate = useCallback((dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }, []);

  return (
    <div className="w-60 bg-bg-secondary h-full border-l border-border flex flex-col">
      <div className="p-3 border-b border-border flex-shrink-0">
        <h3 className="text-sm font-semibold text-text-primary">Pinned Messages</h3>
        <p className="text-xs text-text-muted mt-0.5">
          {pinnedMessages.length} pinned in #{channelName}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {pinnedMessages.length === 0 ? (
          <div className="p-4 text-center">
            <svg className="w-10 h-10 text-text-muted mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v3a2 2 0 01-1 1.73V14l1 1v1H5v-1l1-1V9.73A2 2 0 015 8V5zm7 14v3" />
            </svg>
            <p className="text-sm text-text-muted">No pinned messages yet</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {pinnedMessages.map((pm) => (
              <div
                key={pm.id}
                className="p-3 hover:bg-bg-modifier-hover transition-colors border-b border-border/50"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Avatar
                    src={pm.author.avatar_url}
                    alt={pm.author.display_name || pm.author.username}
                    size="xs"
                  />
                  <span className="text-xs font-medium text-text-primary truncate">
                    {pm.author.display_name || pm.author.username}
                  </span>
                  <span className="text-[10px] text-text-muted ml-auto flex-shrink-0">
                    {formatDate(pm.created_at)}
                  </span>
                </div>
                <div className="text-xs text-text-secondary line-clamp-3 break-words">
                  <MessageContent content={pm.content} />
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[10px] text-text-muted">
                    Pinned by {pm.pinned_by.username}
                  </span>
                  {canManageMessages && onUnpin && (
                    <button
                      onClick={() => onUnpin(pm.id)}
                      className="text-[10px] text-text-muted hover:text-danger transition-colors"
                      title="Unpin message"
                    >
                      Unpin
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
