import { For, Show } from 'solid-js';
import { clsx } from 'clsx';

export interface Reaction {
  emoji: string;
  count: number;
  users: string[]; // user IDs who reacted
  me: boolean; // whether current user has reacted with this emoji
}

interface ReactionDisplayProps {
  reactions: Reaction[];
  onReactionClick: (emoji: string) => void;
  onAddReaction?: () => void;
  currentUserId?: string;
}

export function ReactionDisplay(props: ReactionDisplayProps) {
  return (
    <Show when={props.reactions.length > 0 || props.onAddReaction}>
      <div class="flex flex-wrap gap-1 mt-1">
        <For each={props.reactions}>
          {(reaction) => (
            <button
              onClick={() => props.onReactionClick(reaction.emoji)}
              class={clsx(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors",
                reaction.me
                  ? "bg-brand-primary/20 border border-brand-primary/50 text-text-primary"
                  : "bg-bg-tertiary border border-border-subtle text-text-secondary hover:bg-bg-modifier-hover"
              )}
              title={`${reaction.users.length} ${reaction.users.length === 1 ? 'person' : 'people'} reacted`}
            >
              <span class="text-sm">{reaction.emoji}</span>
              <span class="font-medium">{reaction.count}</span>
            </button>
          )}
        </For>
        
        {/* Add Reaction Button */}
        <Show when={props.onAddReaction}>
          <button
            onClick={props.onAddReaction}
            class="inline-flex items-center justify-center w-7 h-6 rounded-full bg-bg-tertiary border border-border-subtle text-text-muted hover:bg-bg-modifier-hover hover:text-text-primary transition-colors"
            title="Add reaction"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </Show>
      </div>
    </Show>
  );
}
