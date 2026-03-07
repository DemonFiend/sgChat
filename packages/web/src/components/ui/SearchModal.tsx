import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Avatar } from '@/components/ui/Avatar';
import { api } from '@/api';

interface SearchResult {
  id: string;
  content: string;
  highlighted_content: string;
  channel_id?: string;
  channel_name?: string;
  dm_channel_id?: string;
  created_at: string;
  edited_at: string | null;
  attachments: any[];
  author: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
  };
}

interface SearchResponse {
  results: SearchResult[];
  total_count: number;
  query: string;
}

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelId?: string;
  channelName?: string;
  dmChannelId?: string;
  onNavigateToMessage?: (channelId: string, messageId: string) => void;
}

export function SearchModal({
  isOpen,
  onClose,
  channelId,
  channelName,
  dmChannelId,
  onNavigateToMessage,
}: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchScope, setSearchScope] = useState<'channel' | 'server'>(channelId ? 'channel' : 'server');
  const [hasAttachment, setHasAttachment] = useState(false);
  const [offset, setOffset] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setTotalCount(0);
      setOffset(0);
      setSearchScope(channelId ? 'channel' : 'server');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, channelId]);

  const performSearch = useCallback(
    async (q: string, newOffset: number, append = false) => {
      if (q.trim().length < 2) {
        if (!append) {
          setResults([]);
          setTotalCount(0);
        }
        return;
      }

      setLoading(true);
      try {
        const params = new URLSearchParams({ q: q.trim(), limit: '25', offset: String(newOffset) });
        if (hasAttachment) params.set('has_attachment', 'true');

        let endpoint: string;
        if (dmChannelId) {
          endpoint = `/dms/${dmChannelId}/messages/search?${params}`;
        } else if (searchScope === 'channel' && channelId) {
          endpoint = `/channels/${channelId}/messages/search?${params}`;
        } else {
          endpoint = `/search/messages?${params}`;
        }

        const data = await api.get<SearchResponse>(endpoint);
        if (append) {
          setResults((prev) => [...prev, ...data.results]);
        } else {
          setResults(data.results);
        }
        setTotalCount(data.total_count);
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    },
    [channelId, dmChannelId, searchScope, hasAttachment],
  );

  // Debounced search on query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setOffset(0);
    debounceRef.current = setTimeout(() => {
      performSearch(query, 0);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, performSearch]);

  const loadMore = () => {
    const newOffset = offset + 25;
    setOffset(newOffset);
    performSearch(query, newOffset, true);
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />

        {/* Modal */}
        <motion.div
          className="relative bg-bg-primary rounded-lg shadow-xl w-full max-w-2xl max-h-[70vh] flex flex-col border border-border"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Search Input */}
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                name="search-messages"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  dmChannelId
                    ? 'Search messages...'
                    : searchScope === 'channel' && channelName
                      ? `Search in #${channelName}...`
                      : 'Search all channels...'
                }
                className="flex-1 bg-transparent text-text-primary outline-none text-sm placeholder:text-text-muted"
              />
              {loading && (
                <div className="w-4 h-4 border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
              )}
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3 mt-2">
              {!dmChannelId && channelId && (
                <div className="flex items-center gap-1 text-xs">
                  <button
                    onClick={() => setSearchScope('channel')}
                    className={`px-2 py-0.5 rounded ${searchScope === 'channel' ? 'bg-brand-primary text-white' : 'text-text-muted hover:text-text-primary'}`}
                  >
                    This Channel
                  </button>
                  <button
                    onClick={() => setSearchScope('server')}
                    className={`px-2 py-0.5 rounded ${searchScope === 'server' ? 'bg-brand-primary text-white' : 'text-text-muted hover:text-text-primary'}`}
                  >
                    All Channels
                  </button>
                </div>
              )}
              <label className="flex items-center gap-1 text-xs text-text-muted cursor-pointer">
                <input
                  type="checkbox"
                  name="has-attachment"
                  checked={hasAttachment}
                  onChange={(e) => setHasAttachment(e.target.checked)}
                  className="rounded border-border"
                />
                Has files
              </label>
            </div>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {results.length === 0 && query.trim().length >= 2 && !loading ? (
              <div className="p-8 text-center">
                <p className="text-sm text-text-muted">No results found for "{query}"</p>
              </div>
            ) : results.length === 0 && query.trim().length < 2 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-text-muted">Type at least 2 characters to search</p>
              </div>
            ) : (
              <div>
                {totalCount > 0 && (
                  <div className="px-4 py-2 text-xs text-text-muted border-b border-border/50">
                    {totalCount} result{totalCount !== 1 ? 's' : ''}
                  </div>
                )}
                {results.map((result) => (
                  <button
                    key={result.id}
                    className="w-full text-left px-4 py-3 hover:bg-bg-modifier-hover transition-colors border-b border-border/30"
                    onClick={() => {
                      if (result.channel_id && onNavigateToMessage) {
                        onNavigateToMessage(result.channel_id, result.id);
                      }
                      onClose();
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Avatar
                        src={result.author.avatar_url}
                        alt={result.author.display_name}
                        size="xs"
                      />
                      <span className="text-xs font-medium text-text-primary">
                        {result.author.display_name}
                      </span>
                      {result.channel_name && searchScope === 'server' && (
                        <span className="text-[10px] text-text-muted">
                          in #{result.channel_name}
                        </span>
                      )}
                      <span className="text-[10px] text-text-muted ml-auto">
                        {formatTime(result.created_at)}
                      </span>
                    </div>
                    <div
                      className="text-sm text-text-secondary line-clamp-2 [&_mark]:bg-brand-primary/30 [&_mark]:text-text-primary [&_mark]:rounded-sm [&_mark]:px-0.5"
                      dangerouslySetInnerHTML={{ __html: result.highlighted_content }}
                    />
                  </button>
                ))}
                {results.length < totalCount && (
                  <button
                    onClick={loadMore}
                    disabled={loading}
                    className="w-full py-3 text-sm text-brand-primary hover:text-brand-primary/80 transition-colors"
                  >
                    {loading ? 'Loading...' : `Load more (${totalCount - results.length} remaining)`}
                  </button>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
