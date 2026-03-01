import { clsx } from 'clsx';

export interface Reaction {
  emoji: string;
  count: number;
  users: string[];
  me: boolean;
}

interface ReactionDisplayProps {
  reactions: Reaction[];
  onReactionClick: (emoji: string) => void;
  onAddReaction?: () => void;
  currentUserId?: string;
}

export function ReactionDisplay({ reactions, onReactionClick, onAddReaction }: ReactionDisplayProps) {
  if (reactions.length === 0 && !onAddReaction) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          onClick={() => onReactionClick(reaction.emoji)}
          className={clsx(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors",
            reaction.me
              ? "bg-brand-primary/20 border border-brand-primary/50 text-text-primary"
              : "bg-bg-tertiary border border-border-subtle text-text-secondary hover:bg-bg-modifier-hover"
          )}
          title={`${reaction.users.length} ${reaction.users.length === 1 ? 'person' : 'people'} reacted`}
        >
          <span className="text-sm">{reaction.emoji}</span>
          <span className="font-medium">{reaction.count}</span>
        </button>
      ))}

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
