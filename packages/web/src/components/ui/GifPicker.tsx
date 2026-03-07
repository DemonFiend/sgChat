import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNetworkStore } from '@/stores/network';
import { api } from '@/api';

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

export function GifPicker({ isOpen, onClose, onSelect, anchorRef }: GifPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentUrl = useNetworkStore((s) => s.currentUrl);

  const fetchGifs = useCallback(async (query?: string) => {
    setIsLoading(true);
    setError(null);
    setRateLimited(false);

    try {
      const endpoint = query
        ? `/giphy/search?q=${encodeURIComponent(query)}&limit=25`
        : `/giphy/trending?limit=25`;

      const data = await api.get<{ gifs?: GifItem[]; message?: string }>(endpoint);
      setGifs(data?.gifs || []);
    } catch (err: any) {
      if (err?.status === 429) {
        setRateLimited(true);
        setError(err.message || 'Rate limit exceeded');
      } else if (err?.status === 503) {
        setError('GIF feature is not available on this server');
      } else {
        console.error('Failed to fetch GIFs:', err);
        setError('Failed to load GIFs');
      }
      setGifs([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentUrl]);

  // Load trending GIFs when opened
  useEffect(() => {
    if (isOpen) {
      fetchGifs();
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!isOpen) return;

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (searchQuery.trim()) {
      searchTimeoutRef.current = setTimeout(() => {
        fetchGifs(searchQuery.trim());
      }, 300);
    } else {
      fetchGifs();
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  const handleGifClick = (gif: GifItem) => {
    onSelect(gif.url);
    onClose();
    setSearchQuery('');
  };

  const getPosition = (): React.CSSProperties => {
    if (anchorRef) {
      const rect = anchorRef.getBoundingClientRect();
      const pickerWidth = 384;
      const maxLeft = window.innerWidth - pickerWidth - 16;
      const left = Math.max(16, Math.min(rect.left - pickerWidth / 2, maxLeft));

      return {
        bottom: `${window.innerHeight - rect.top + 8}px`,
        left: `${left}px`,
      };
    }
    return { bottom: '80px', left: '50%', transform: 'translateX(-50%)' };
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute bg-bg-secondary rounded-lg shadow-xl border border-border-subtle overflow-hidden w-96"
        style={getPosition()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-3 border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-text-muted" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.5 9H13v6h-1.5V9zM9 9H6c-.5 0-1 .5-1 1v4c0 .5.5 1 1 1h3c.5 0 1-.5 1-1v-4c0-.5-.5-1-1-1zm-.5 4.5h-2v-3h2v3zm14-6H12v1.5h10V6H12v1.5h10.5v-1zm-1.5 3h-4V9H17v2.5h3V9h-1.5v2.5zm-2 1.5H16v1.5h3c.5 0 1-.5 1-1V9h-1.5v4h-1.5v-3h-1v3z" />
            </svg>
            <span className="text-sm font-medium text-text-primary">GIFs</span>
          </div>
          <span className="text-xs text-text-muted">Powered by GIPHY</span>
        </div>

        {/* Search */}
        <div className="p-2 border-b border-border-subtle">
          <input
            ref={inputRef}
            type="text"
            name="gif-search"
            placeholder="Search GIFs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-brand-primary"
          />
        </div>

        {/* Content */}
        <div className="h-72 overflow-y-auto p-2">
          {isLoading && (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-primary border-t-transparent" />
            </div>
          )}

          {error && !isLoading && (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              {rateLimited ? (
                <svg className="w-12 h-12 text-status-warning mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="w-12 h-12 text-status-danger mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              )}
              <p className="text-sm text-text-muted">{error}</p>
            </div>
          )}

          {!isLoading && !error && gifs.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <svg className="w-12 h-12 text-text-muted mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <p className="text-sm text-text-muted">
                {searchQuery ? 'No GIFs found' : 'Start typing to search GIFs'}
              </p>
            </div>
          )}

          {!isLoading && !error && gifs.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {gifs.map((gif) => (
                <button
                  key={gif.id}
                  onClick={() => handleGifClick(gif)}
                  className="relative overflow-hidden rounded-lg hover:ring-2 hover:ring-brand-primary transition-all aspect-video bg-bg-tertiary"
                  title={gif.title}
                >
                  <img
                    src={gif.preview}
                    alt={gif.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLImageElement).src = gif.url;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLImageElement).src = gif.preview;
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
