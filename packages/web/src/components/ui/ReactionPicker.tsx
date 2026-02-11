import { createSignal, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { clsx } from 'clsx';

// Common emoji reactions for quick access
const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🎉', '🔥', '👀', '💯'];

// Emoji categories
const EMOJI_CATEGORIES = [
  {
    name: 'Smileys',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😮‍💨', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷']
  },
  {
    name: 'Gestures',
    emojis: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏']
  },
  {
    name: 'Hearts',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟']
  },
  {
    name: 'Objects',
    emojis: ['🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉', '⭐', '🌟', '💫', '✨', '🔥', '💥', '💢', '💯', '💤', '💨', '💦', '🎵', '🎶', '🔔', '🔕', '📢', '📣']
  },
  {
    name: 'Animals',
    emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄']
  }
];

interface ReactionPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
  anchorRef?: HTMLElement | null;
  position?: { x: number; y: number };
}

export function ReactionPicker(props: ReactionPickerProps) {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [activeCategory, setActiveCategory] = createSignal(0);

  const filteredEmojis = () => {
    const query = searchQuery().toLowerCase();
    if (!query) return null;
    
    const allEmojis = EMOJI_CATEGORIES.flatMap(cat => cat.emojis);
    // Simple filter - in real app would use emoji names/keywords
    return allEmojis;
  };

  const handleEmojiClick = (emoji: string) => {
    props.onSelect(emoji);
    props.onClose();
  };

  const getPosition = () => {
    if (props.position) {
      return { top: `${props.position.y}px`, left: `${props.position.x}px` };
    }
    if (props.anchorRef) {
      const rect = props.anchorRef.getBoundingClientRect();
      return { 
        top: `${rect.top - 340}px`, 
        left: `${Math.max(8, rect.left - 150)}px` 
      };
    }
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  };

  return (
    <Show when={props.isOpen}>
      <Portal>
        <div class="fixed inset-0 z-50" onClick={props.onClose}>
          <div 
            class="absolute bg-bg-secondary rounded-lg shadow-xl border border-border-subtle overflow-hidden w-80"
            style={getPosition()}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search */}
            <div class="p-2 border-b border-border-subtle">
              <input
                type="text"
                placeholder="Search emojis..."
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                class="w-full px-3 py-1.5 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-brand-primary"
              />
            </div>

            {/* Quick Access */}
            <div class="p-2 border-b border-border-subtle">
              <div class="text-xs font-semibold uppercase text-text-muted mb-1.5">Quick Reactions</div>
              <div class="flex flex-wrap gap-1">
                <For each={QUICK_EMOJIS}>
                  {(emoji) => (
                    <button
                      onClick={() => handleEmojiClick(emoji)}
                      class="w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-bg-modifier-hover transition-colors"
                    >
                      {emoji}
                    </button>
                  )}
                </For>
              </div>
            </div>

            {/* Category Tabs */}
            <div class="flex border-b border-border-subtle overflow-x-auto scrollbar-none">
              <For each={EMOJI_CATEGORIES}>
                {(category, index) => (
                  <button
                    onClick={() => setActiveCategory(index())}
                    class={clsx(
                      "px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors",
                      activeCategory() === index()
                        ? "text-brand-primary border-b-2 border-brand-primary"
                        : "text-text-muted hover:text-text-primary"
                    )}
                  >
                    {category.name}
                  </button>
                )}
              </For>
            </div>

            {/* Emoji Grid */}
            <div class="h-48 overflow-y-auto p-2">
              <Show 
                when={!searchQuery()}
                fallback={
                  <div class="grid grid-cols-8 gap-1">
                    <For each={filteredEmojis()}>
                      {(emoji) => (
                        <button
                          onClick={() => handleEmojiClick(emoji)}
                          class="w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-bg-modifier-hover transition-colors"
                        >
                          {emoji}
                        </button>
                      )}
                    </For>
                  </div>
                }
              >
                <div class="grid grid-cols-8 gap-1">
                  <For each={EMOJI_CATEGORIES[activeCategory()].emojis}>
                    {(emoji) => (
                      <button
                        onClick={() => handleEmojiClick(emoji)}
                        class="w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-bg-modifier-hover transition-colors"
                      >
                        {emoji}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
