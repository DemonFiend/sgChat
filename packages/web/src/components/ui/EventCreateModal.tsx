import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import type { ServerEvent } from '@sgchat/shared';
import { useEventsStore } from '@/stores/events';

interface ChannelOption {
  id: string;
  name: string;
  type: string;
}

interface EventCreateModalProps {
  serverId: string;
  onClose: () => void;
  editEvent?: ServerEvent | null;
  channels: ChannelOption[];
}

function toLocalDatetime(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  // Round up to next hour if creating new
  if (!iso) {
    d.setHours(d.getHours() + 1, 0, 0, 0);
  }
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function addHour(datetime: string): string {
  const d = new Date(datetime);
  d.setHours(d.getHours() + 1);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

export function EventCreateModal({
  serverId,
  onClose,
  editEvent,
  channels,
}: EventCreateModalProps) {
  const createEvent = useEventsStore((s) => s.createEvent);
  const updateEvent = useEventsStore((s) => s.updateEvent);

  const [title, setTitle] = useState(editEvent?.title || '');
  const [description, setDescription] = useState(editEvent?.description || '');
  const [startTime, setStartTime] = useState(toLocalDatetime(editEvent?.start_time));
  const [endTime, setEndTime] = useState(
    editEvent?.end_time ? toLocalDatetime(editEvent.end_time) : addHour(toLocalDatetime(editEvent?.start_time)),
  );
  const [announceAtStart, setAnnounceAtStart] = useState(editEvent?.announce_at_start ?? true);
  const [announcementChannelId, setAnnouncementChannelId] = useState(
    editEvent?.announcement_channel_id || '',
  );
  const [visibility, setVisibility] = useState<'public' | 'private'>(
    editEvent?.visibility || 'public',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!editEvent;

  // Auto-set end time when start time changes (for new events)
  useEffect(() => {
    if (!isEditing && startTime) {
      setEndTime(addHour(startTime));
    }
  }, [startTime, isEditing]);

  const textChannels = channels.filter(
    (c) => c.type === 'text' || c.type === 'announcement',
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    const startDate = new Date(startTime);
    const endDate = new Date(endTime);

    if (endDate <= startDate) {
      setError('End time must be after start time');
      return;
    }

    setIsSubmitting(true);
    try {
      const data = {
        title: title.trim(),
        description: description.trim() || null,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        announce_at_start: announceAtStart,
        announcement_channel_id: announcementChannelId || null,
        visibility,
      };

      if (isEditing) {
        await updateEvent(serverId, editEvent.id, data);
      } else {
        await createEvent(serverId, data);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save event');
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.15 }}
          className="bg-bg-secondary rounded-xl border border-divider shadow-2xl w-full max-w-md mx-4 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <form onSubmit={handleSubmit}>
            <div className="px-5 pt-5 pb-3">
              <h2 className="text-lg font-semibold text-text-primary">
                {isEditing ? 'Edit Event' : 'Create Event'}
              </h2>
            </div>

            <div className="px-5 py-3 space-y-4">
              {error && (
                <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
                  {error}
                </div>
              )}

              {/* Title */}
              <div>
                <label className="block text-xs font-medium text-text-muted uppercase mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={150}
                  className="w-full px-3 py-2 bg-bg-tertiary border border-divider rounded text-sm text-text-primary focus:outline-none focus:border-brand-primary"
                  placeholder="Event title"
                  autoFocus
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-text-muted uppercase mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  className="w-full px-3 py-2 bg-bg-tertiary border border-divider rounded text-sm text-text-primary focus:outline-none focus:border-brand-primary resize-none"
                  placeholder="Optional description"
                />
              </div>

              {/* Start Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-muted uppercase mb-1">
                    Start Time *
                  </label>
                  <input
                    type="datetime-local"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-3 py-2 bg-bg-tertiary border border-divider rounded text-sm text-text-primary focus:outline-none focus:border-brand-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted uppercase mb-1">
                    End Time
                  </label>
                  <input
                    type="datetime-local"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-3 py-2 bg-bg-tertiary border border-divider rounded text-sm text-text-primary focus:outline-none focus:border-brand-primary"
                  />
                </div>
              </div>

              {/* Announce at start */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={announceAtStart}
                  onChange={(e) => setAnnounceAtStart(e.target.checked)}
                  className="w-4 h-4 rounded border-divider bg-bg-tertiary accent-brand-primary"
                />
                <span className="text-sm text-text-secondary">Announce when event starts</span>
              </label>

              {/* Announcement channel */}
              {announceAtStart && (
                <div>
                  <label className="block text-xs font-medium text-text-muted uppercase mb-1">
                    Announcement Channel
                  </label>
                  <select
                    value={announcementChannelId}
                    onChange={(e) => setAnnouncementChannelId(e.target.value)}
                    className="w-full px-3 py-2 bg-bg-tertiary border border-divider rounded text-sm text-text-primary focus:outline-none focus:border-brand-primary"
                  >
                    <option value="">Default (welcome channel)</option>
                    {textChannels.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        #{ch.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Visibility */}
              <div>
                <label className="block text-xs font-medium text-text-muted uppercase mb-1">
                  Visibility
                </label>
                <div className="flex gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="visibility"
                      checked={visibility === 'public'}
                      onChange={() => setVisibility('public')}
                      className="accent-brand-primary"
                    />
                    <span className="text-sm text-text-secondary">Public</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="visibility"
                      checked={visibility === 'private'}
                      onChange={() => setVisibility('private')}
                      className="accent-brand-primary"
                    />
                    <span className="text-sm text-text-secondary">Private</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-divider flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !title.trim()}
                className="px-4 py-1.5 text-sm bg-brand-primary text-white rounded hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Event'}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
