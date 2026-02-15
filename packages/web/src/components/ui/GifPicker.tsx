import { createSignal, createEffect, For, Show, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { clsx } from 'clsx';
import { getEffectiveUrl, networkStore } from '@/stores/network';
import { authStore } from '@/stores/auth';

interface GifItem {
  id: string;
  title: string;
  url: string;
  preview: string;
  width: number;
  height: number;
}

interface GifPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (gifUrl: string) => void;
  anchorRef?: HTMLElement | null;
}

export function GifPicker(props: GifPickerProps) {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [gifs, setGifs] = createSignal<GifItem[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [rateLimited, setRateLimited] = createSignal(false);

  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  let inputRef: HTMLInputElement | undefined;

  // Fetch GIFs from backend proxy
  const fetchGifs = async (query?: string) => {
    const apiUrl = getEffectiveUrl(networkStore.currentUrl());
    const token = authStore.getAccessToken();
    
    if (!apiUrl || !token) {
      setError('Not authenticated');
      return;
    }

    setIsLoading(true);
    setError(null);
    setRateLimited(false);

    try {
      const endpoint = query
        ? `${apiUrl}/giphy/search?q=${encodeURIComponent(query)}&limit=25`
        : `${apiUrl}/giphy/trending?limit=25`;

      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 429) {
        const data = await response.json();
        setRateLimited(true);
        setError(data.message || 'Rate limit exceeded');
        setGifs([]);
        return;
      }

      if (response.status === 503) {
        setError('GIF feature is not available on this server');
        setGifs([]);
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch GIFs');
      }

      const data = await response.json();
      setGifs(data.gifs || []);
    } catch (err) {
      console.error('Failed to fetch GIFs:', err);
      setError('Failed to load GIFs');
      setGifs([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Load trending GIFs when opened
  createEffect(() => {
    if (props.isOpen) {
      fetchGifs();
      // Focus search input after a short delay
      setTimeout(() => inputRef?.focus(), 100);
    }
  });

  // Debounced search
  createEffect(() => {
    const query = searchQuery();
    
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    if (query.trim()) {
      searchTimeout = setTimeout(() => {
        fetchGifs(query.trim());
      }, 300);
    } else if (props.isOpen) {
      // If query is cleared, show trending
      fetchGifs();
    }
  });

  onCleanup(() => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
  });

  const handleGifClick = (gif: GifItem) => {
    props.onSelect(gif.url);
    props.onClose();
    setSearchQuery('');
  };

  const getPosition = () => {
    if (props.anchorRef) {
      const rect = props.anchorRef.getBoundingClientRect();
      // Position above the button, ensuring it doesn't go off-screen to the right
      // The picker is 384px wide (w-96), so we need to ensure it fits
      const pickerWidth = 384;
      const rightEdge = rect.left + pickerWidth;
      const maxLeft = window.innerWidth - pickerWidth - 16; // 16px margin from right edge
      const left = Math.max(16, Math.min(rect.left - pickerWidth / 2, maxLeft));
      
      return {
        bottom: `${window.innerHeight - rect.top + 8}px`,
        left: `${left}px`,
      };
    }
    return { bottom: '80px', left: '50%', transform: 'translateX(-50%)' };
  };

  return (
    <Show when={props.isOpen}>
      <Portal>
        <div class="fixed inset-0 z-50" onClick={props.onClose}>
          <div
            class="absolute bg-bg-secondary rounded-lg shadow-xl border border-border-subtle overflow-hidden w-96"
            style={getPosition()}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div class="p-3 border-b border-border-subtle flex items-center justify-between">
              <div class="flex items-center gap-2">
                <svg class="w-5 h-5 text-text-muted" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.5 9H13v6h-1.5V9zM9 9H6c-.5 0-1 .5-1 1v4c0 .5.5 1 1 1h3c.5 0 1-.5 1-1v-4c0-.5-.5-1-1-1zm-.5 4.5h-2v-3h2v3zm14-6H12v1.5h10V6H12v1.5h10.5v-1zm-1.5 3h-4V9H17v2.5h3V9h-1.5v2.5zm-2 1.5H16v1.5h3c.5 0 1-.5 1-1V9h-1.5v4h-1.5v-3h-1v3z" />
                </svg>
                <span class="text-sm font-medium text-text-primary">GIFs</span>
              </div>
              <span class="text-xs text-text-muted">Powered by GIPHY</span>
            </div>

            {/* Search */}
            <div class="p-2 border-b border-border-subtle">
              <input
                ref={inputRef}
                type="text"
                placeholder="Search GIFs..."
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-brand-primary"
              />
            </div>

            {/* Content */}
            <div class="h-72 overflow-y-auto p-2">
              <Show when={isLoading()}>
                <div class="flex items-center justify-center h-full">
                  <div class="animate-spin rounded-full h-8 w-8 border-2 border-brand-primary border-t-transparent" />
                </div>
              </Show>

              <Show when={error() && !isLoading()}>
                <div class="flex flex-col items-center justify-center h-full text-center px-4">
                  <Show when={rateLimited()}>
                    <svg class="w-12 h-12 text-status-warning mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </Show>
                  <Show when={!rateLimited()}>
                    <svg class="w-12 h-12 text-status-danger mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </Show>
                  <p class="text-sm text-text-muted">{error()}</p>
                </div>
              </Show>

              <Show when={!isLoading() && !error() && gifs().length === 0}>
                <div class="flex flex-col items-center justify-center h-full text-center">
                  <svg class="w-12 h-12 text-text-muted mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <p class="text-sm text-text-muted">
                    {searchQuery() ? 'No GIFs found' : 'Start typing to search GIFs'}
                  </p>
                </div>
              </Show>

              <Show when={!isLoading() && !error() && gifs().length > 0}>
                <div class="grid grid-cols-2 gap-2">
                  <For each={gifs()}>
                    {(gif) => (
                      <button
                        onClick={() => handleGifClick(gif)}
                        class="relative overflow-hidden rounded-lg hover:ring-2 hover:ring-brand-primary transition-all aspect-video bg-bg-tertiary"
                        title={gif.title}
                      >
                        <img
                          src={gif.preview}
                          alt={gif.title}
                          class="w-full h-full object-cover"
                          loading="lazy"
                          onMouseEnter={(e) => {
                            // Show animated GIF on hover
                            (e.currentTarget as HTMLImageElement).src = gif.url;
                          }}
                          onMouseLeave={(e) => {
                            // Show still preview when not hovering
                            (e.currentTarget as HTMLImageElement).src = gif.preview;
                          }}
                        />
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
