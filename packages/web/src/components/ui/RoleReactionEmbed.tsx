import { useMemo } from 'react';
import { MessageContent } from './MessageContent';
import clsx from 'clsx';

interface Reaction {
  type?: string;
  emoji?: string;
  emojiId?: string;
  shortcode?: string;
  url?: string;
  count: number;
  me: boolean;
}

interface RoleReactionSystemEvent {
  type: string;
  group_id: string;
  group_name: string;
  description?: string | null;
  exclusive?: boolean;
}

interface RoleReactionEmbedProps {
  content: string;
  systemEvent?: RoleReactionSystemEvent | null;
  reactions: Reaction[];
  onReactionClick: (reaction: Reaction) => void;
  serverId?: string;
}

export function RoleReactionEmbed({
  content,
  systemEvent,
  reactions,
  onReactionClick,
  serverId,
}: RoleReactionEmbedProps) {
  const { headerLine, mappingLines } = useMemo(() => {
    const lines = content.split('\n').filter((l) => l.trim() !== '');
    return {
      headerLine: lines[0] || '',
      mappingLines: lines.slice(1),
    };
  }, [content]);

  // Separate description lines from mapping lines
  const { descriptionLines, roleMappingLines } = useMemo(() => {
    const desc: string[] = [];
    const mappings: string[] = [];
    for (const line of mappingLines) {
      if (line.startsWith('Please React') || line.startsWith('React')) {
        mappings.push(line);
      } else {
        desc.push(line);
      }
    }
    return { descriptionLines: desc, roleMappingLines: mappings };
  }, [mappingLines]);

  // Extract group name from header (strip **Category:** prefix)
  const groupName = useMemo(() => {
    const match = headerLine.match(/\*\*Category:\*\*\s*(.*)/);
    return match ? match[1] : systemEvent?.group_name || headerLine;
  }, [headerLine, systemEvent?.group_name]);

  return (
    <div className="my-1 border-l-4 border-brand-primary pl-4 py-3 bg-bg-tertiary/40 rounded-r-lg max-w-lg">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base font-semibold text-text-primary">{groupName}</span>
        {systemEvent?.exclusive && (
          <span className="text-[10px] font-medium bg-accent/20 text-accent px-1.5 py-0.5 rounded-full">
            Pick one
          </span>
        )}
      </div>

      {/* Description */}
      {descriptionLines.length > 0 && (
        <div className="text-sm text-text-muted mb-2">
          {descriptionLines.map((line, i) => (
            <span key={i} className="block">
              <MessageContent content={line} serverId={serverId} />
            </span>
          ))}
        </div>
      )}

      {/* Role mapping lines */}
      <div className="space-y-0.5">
        {roleMappingLines.map((line, i) => (
          <div key={i} className="text-sm text-text-secondary">
            <MessageContent content={line} serverId={serverId} />
          </div>
        ))}
      </div>

      {/* Reactions */}
      {reactions && reactions.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3 pt-2 border-t border-border/30">
          {reactions.map((r) => {
            const isCustom = r.type === 'custom' || !!(r as any).emojiId;
            const key = isCustom ? `custom:${(r as any).emojiId}` : `unicode:${r.emoji}`;
            return (
              <button
                key={key}
                onClick={() => onReactionClick(r)}
                className={clsx(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors',
                  r.me
                    ? 'bg-accent/20 border-accent text-accent'
                    : 'bg-bg-tertiary border-transparent text-text-muted hover:border-border',
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
                    <span className="w-4 h-4 bg-bg-modifier-hover rounded flex items-center justify-center text-[10px]">
                      ?
                    </span>
                  )
                ) : (
                  <span>{r.emoji}</span>
                )}
                <span>{r.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
