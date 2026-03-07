import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/api';

interface Sticker {
  id: string;
  server_id: string;
  name: string;
  description: string | null;
  file_url: string;
  file_type: string;
}

interface StickerPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (sticker: Sticker) => void;
  anchorRef?: HTMLElement | null;
  serverId?: string;
}

export function StickerPicker({ isOpen, onClose, onSelect, anchorRef, serverId }: StickerPickerProps) {
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchStickers = useCallback(async () => {
    if (!serverId) return;
    setLoading(true);
    try {
      const response = await api.get<{ stickers: Sticker[] }>(`/servers/${serverId}/stickers`);
      setStickers(response.stickers || []);
    } catch (err) {
      console.error('[StickerPicker] Failed to fetch stickers:', err);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    if (isOpen && serverId) {
      fetchStickers();
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, serverId, fetchStickers]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        anchorRef &&
        !anchorRef.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen) return null;

  const filteredStickers = search
    ? stickers.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          (s.description && s.description.toLowerCase().includes(search.toLowerCase())),
      )
    : stickers;

  // Position the picker above the anchor button
  const anchorRect = anchorRef?.getBoundingClientRect();
  const style: React.CSSProperties = anchorRect
    ? {
        position: 'fixed',
        bottom: window.innerHeight - anchorRect.top + 8,
        right: window.innerWidth - anchorRect.right,
        zIndex: 60,
      }
    : {
        position: 'fixed',
        bottom: 80,
        right: 20,
        zIndex: 60,
      };

  return createPortal(
    <div ref={panelRef} style={style} className="w-[340px] bg-bg-secondary rounded-lg shadow-xl border border-border-primary flex flex-col max-h-[400px]">
      {/* Header */}
      <div className="p-3 border-b border-border-primary">
        <input
          ref={inputRef}
          type="text"
          name="search-stickers"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search stickers..."
          className="w-full px-3 py-1.5 bg-bg-primary border border-border-primary rounded text-sm text-text-primary placeholder-text-muted"
        />
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-text-muted text-sm">
            Loading stickers...
          </div>
        ) : filteredStickers.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-text-muted text-sm">
            {stickers.length === 0 ? 'No stickers available' : 'No matching stickers'}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-1">
            {filteredStickers.map((sticker) => (
              <button
                key={sticker.id}
                onClick={() => {
                  onSelect(sticker);
                  onClose();
                }}
                className="p-1.5 rounded hover:bg-bg-modifier-hover transition-colors group"
                title={sticker.name}
              >
                <img
                  src={sticker.file_url}
                  alt={sticker.name}
                  className="w-16 h-16 object-contain mx-auto"
                  loading="lazy"
                />
                <div className="text-[10px] text-text-muted truncate text-center mt-0.5 group-hover:text-text-primary">
                  {sticker.name}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
