import { clsx } from 'clsx';

export interface Reaction {
  // Legacy fields (backward compat)
  emoji?: string;
  // Typed reaction fields
  type?: 'unicode' | 'custom';
  emojiId?: string;
  shortcode?: string;
  url?: string;
  is_animated?: boolean;
  // Common fields
  count: number;
  users: string[];
  me: boolean;
}

interface ReactionDisplayProps {
  reactions: Reaction[];
  onReactionClick: (reaction: Reaction) => void;
  onAddReaction?: () => void;
  currentUserId?: string;
}

export function ReactionDisplay({ reactions, onReactionClick, onAddReaction }: ReactionDisplayProps) {
  if (reactions.length === 0 && !onAddReaction) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reactions.map((reaction) => {
        const isCustom = reaction.type === 'custom' || !!reaction.emojiId;
        const key = isCustom
          ? `custom:${reaction.emojiId}`
          : `unicode:${reaction.emoji}`;

        return (
          <button
            key={key}
            onClick={() => onReactionClick(reaction)}
            className={clsx(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors",
              reaction.me
                ? "bg-brand-primary/20 border border-brand-primary/50 text-text-primary"
                : "bg-bg-tertiary border border-border-subtle text-text-secondary hover:bg-bg-modifier-hover"
            )}
            title={`${reaction.users.length} ${reaction.users.length === 1 ? 'person' : 'people'} reacted${reaction.shortcode ? ` with :${reaction.shortcode}:` : ''}`}
          >
            {isCustom ? (
              reaction.url ? (
                <img
                  src={reaction.url}
                  alt={reaction.shortcode ? `:${reaction.shortcode}:` : 'emoji'}
                  className="w-4 h-4 object-contain"
                  loading="lazy"
                />
              ) : (
                <span className="w-4 h-4 bg-bg-modifier-hover rounded flex items-center justify-center text-[10px]" title={reaction.shortcode ? `:${reaction.shortcode}: (deleted)` : 'Deleted emoji'}>?</span>
              )
            ) : (
              <span className="text-sm">{reaction.emoji}</span>
            )}
            <span className="font-medium">{reaction.count}</span>
          </button>
        );
      })}

      {onAddReaction && (
        <button
          onClick={onAddReaction}
          className="inline-flex items-center justify-center w-7 h-6 rounded-full bg-bg-tertiary border border-border-subtle text-text-muted hover:bg-bg-modifier-hover hover:text-text-primary transition-colors"
          title="Add reaction"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      )}
    </div>
  );
}
