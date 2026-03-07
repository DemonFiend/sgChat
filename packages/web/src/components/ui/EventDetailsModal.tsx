import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import type { ServerEvent, RSVPStatus } from '@sgchat/shared';
import { useEventsStore } from '@/stores/events';
import { canManageEvents, canCreateEvents } from '@/stores/permissions';
import { authStore } from '@/stores/auth';

interface EventDetailsModalProps {
  event: ServerEvent;
  serverId: string;
  serverTimezone?: string;
  onClose: () => void;
  onEdit: (event: ServerEvent) => void;
}

const RSVP_OPTIONS: { status: RSVPStatus; label: string; icon: string }[] = [
  { status: 'interested', label: 'Interested', icon: '✓' },
  { status: 'tentative', label: 'Tentative', icon: '?' },
  { status: 'not_interested', label: 'Not Interested', icon: '✗' },
];

export function EventDetailsModal({
  event,
  serverId,
  serverTimezone,
  onClose,
  onEdit,
}: EventDetailsModalProps) {
  const rsvpEvent = useEventsStore((s) => s.rsvpEvent);
  const cancelEvent = useEventsStore((s) => s.cancelEvent);
  const deleteEvent = useEventsStore((s) => s.deleteEvent);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const user = authStore.state().user;
  const isCreator = user?.id === event.created_by;
  const canManage = canManageEvents();
  const canEdit = canManage || (isCreator && canCreateEvents());
  const isCancelled = event.status === 'cancelled';

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: serverTimezone || undefined,
    });
  };

  const handleRSVP = async (status: RSVPStatus) => {
    if (isCancelled) return;
    setIsSubmitting(true);
    try {
      await rsvpEvent(serverId, event.id, status);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm('Cancel this event? It will remain visible but marked as cancelled.')) return;
    setIsSubmitting(true);
    try {
      await cancelEvent(serverId, event.id);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this event? It will be hidden from all views.')) return;
    setIsSubmitting(true);
    try {
      await deleteEvent(serverId, event.id);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const counts = event.rsvp_counts || { interested: 0, tentative: 0, not_interested: 0 };

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
          {/* Header */}
          <div className="px-5 pt-5 pb-3">
            {isCancelled && (
              <div className="mb-2 px-2 py-1 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
                This event has been cancelled
              </div>
            )}
            <h2 className={`text-lg font-semibold text-text-primary ${isCancelled ? 'line-through opacity-60' : ''}`}>
              {event.title}
            </h2>
            {event.description && (
              <p className="mt-1 text-sm text-text-secondary whitespace-pre-wrap">
                {event.description}
              </p>
            )}
          </div>

          {/* Time & Info */}
          <div className="px-5 py-3 border-t border-divider space-y-2">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{formatTime(event.start_time)} — {formatTime(event.end_time)}</span>
            </div>

            {event.creator_username && (
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span>Created by {event.creator_username}</span>
              </div>
            )}

            <div className="flex items-center gap-2 text-sm text-text-secondary">
              {event.visibility === 'private' ? (
                <>
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span>Private event</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Public event</span>
                </>
              )}
            </div>
          </div>

          {/* RSVP */}
          {!isCancelled && (
            <div className="px-5 py-3 border-t border-divider">
              <div className="text-xs font-medium text-text-muted uppercase mb-2">RSVP</div>
              <div className="flex gap-2">
                {RSVP_OPTIONS.map((opt) => (
                  <button
                    key={opt.status}
                    onClick={() => handleRSVP(opt.status)}
                    disabled={isSubmitting}
                    className={`flex-1 py-1.5 px-2 rounded text-sm font-medium transition-colors ${
                      event.my_rsvp === opt.status
                        ? 'bg-brand-primary text-white'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-bg-modifier-hover'
                    }`}
                  >
                    <span className="mr-1">{opt.icon}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-4 mt-2 text-xs text-text-muted">
                <span>{counts.interested} interested</span>
                <span>{counts.tentative} tentative</span>
                <span>{counts.not_interested} declined</span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="px-5 py-3 border-t border-divider flex justify-between">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              Close
            </button>
            {canEdit && (
              <div className="flex gap-2">
                {!isCancelled && (
                  <button
                    onClick={() => onEdit(event)}
                    className="px-3 py-1.5 text-sm bg-bg-tertiary rounded hover:bg-bg-modifier-hover text-text-primary transition-colors"
                  >
                    Edit
                  </button>
                )}
                {canManage && !isCancelled && (
                  <button
                    onClick={handleCancel}
                    disabled={isSubmitting}
                    className="px-3 py-1.5 text-sm bg-yellow-500/10 text-yellow-400 rounded hover:bg-yellow-500/20 transition-colors"
                  >
                    Cancel Event
                  </button>
                )}
                {canManage && (
                  <button
                    onClick={handleDelete}
                    disabled={isSubmitting}
                    className="px-3 py-1.5 text-sm bg-red-500/10 text-red-400 rounded hover:bg-red-500/20 transition-colors"
                  >
                    Delete
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
