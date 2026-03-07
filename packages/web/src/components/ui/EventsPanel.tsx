import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { useEventsStore } from '@/stores/events';
import { canCreateEvents } from '@/stores/permissions';
import { CalendarGrid } from './CalendarGrid';
import { EventDetailsModal } from './EventDetailsModal';
import { EventCreateModal } from './EventCreateModal';
import type { ServerEvent } from '@sgchat/shared';

interface ChannelOption {
  id: string;
  name: string;
  type: string;
}

interface EventsPanelProps {
  serverId: string;
  serverTimezone?: string;
  channels: ChannelOption[];
  serverOwnerId?: string;
  onClose: () => void;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function EventsPanel({
  serverId,
  serverTimezone,
  channels,
  onClose,
}: EventsPanelProps) {
  const {
    events,
    currentMonth,
    selectedDay,
    isLoading,
    isHistory,
    setMonth,
    setSelectedDay,
    setHistory,
    setServerId,
    fetchEvents,
  } = useEventsStore();

  const [selectedEvent, setSelectedEvent] = useState<ServerEvent | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editEvent, setEditEvent] = useState<ServerEvent | null>(null);

  // Parse month
  const [year, month] = useMemo(() => {
    const [y, m] = currentMonth.split('-').map(Number);
    return [y, m];
  }, [currentMonth]);

  // Initialize
  useEffect(() => {
    setServerId(serverId);
    fetchEvents(serverId, currentMonth);
  }, [serverId]);

  // Events for selected day
  const dayEvents = useMemo(() => {
    if (selectedDay === null) return events;
    return events.filter((e) => {
      const start = new Date(e.start_time);
      const end = new Date(e.end_time);
      const dayStart = new Date(year, month - 1, selectedDay);
      const dayEnd = new Date(year, month - 1, selectedDay + 1);
      return start < dayEnd && end > dayStart;
    });
  }, [events, selectedDay, year, month]);

  const navigateMonth = (delta: number) => {
    let newMonth = month + delta;
    let newYear = year;
    if (newMonth < 1) {
      newMonth = 12;
      newYear--;
    } else if (newMonth > 12) {
      newMonth = 1;
      newYear++;
    }
    setMonth(`${newYear}-${String(newMonth).padStart(2, '0')}`);
  };

  const formatEventTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: serverTimezone || undefined,
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider bg-bg-secondary">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <h2 className="text-lg font-semibold text-text-primary">Events</h2>
        </div>

        <div className="flex items-center gap-2">
          {/* History toggle */}
          <button
            onClick={() => setHistory(!isHistory)}
            className={clsx(
              'px-3 py-1 text-xs rounded transition-colors',
              isHistory
                ? 'bg-brand-primary text-white'
                : 'bg-bg-tertiary text-text-secondary hover:bg-bg-modifier-hover',
            )}
          >
            History
          </button>

          {/* Create button */}
          {canCreateEvents() && (
            <button
              onClick={() => {
                setEditEvent(null);
                setShowCreateModal(true);
              }}
              className="px-3 py-1 text-xs bg-brand-primary text-white rounded hover:opacity-90 transition-opacity"
            >
              Create Event
            </button>
          )}

          {/* Close button */}
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-bg-modifier-hover text-text-muted hover:text-text-primary transition-colors"
            title="Close Events"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-lg mx-auto">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => navigateMonth(-1)}
              className="p-1.5 rounded hover:bg-bg-modifier-hover text-text-muted hover:text-text-primary transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h3 className="text-base font-semibold text-text-primary">
              {MONTH_NAMES[month - 1]} {year}
            </h3>
            <button
              onClick={() => navigateMonth(1)}
              className="p-1.5 rounded hover:bg-bg-modifier-hover text-text-muted hover:text-text-primary transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Calendar grid */}
          <CalendarGrid
            year={year}
            month={month}
            events={events}
            selectedDay={selectedDay}
            onSelectDay={(day) => setSelectedDay(day === selectedDay ? null : day)}
          />

          {/* Event list */}
          <div className="mt-6">
            <h4 className="text-xs font-medium text-text-muted uppercase mb-2">
              {selectedDay !== null
                ? `Events on ${MONTH_NAMES[month - 1]} ${selectedDay}`
                : `All Events in ${MONTH_NAMES[month - 1]}`}
            </h4>

            {isLoading ? (
              <div className="text-center py-8 text-text-muted text-sm">Loading events...</div>
            ) : dayEvents.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-sm">
                No events {selectedDay !== null ? 'on this day' : 'this month'}
              </div>
            ) : (
              <div className="space-y-2">
                {dayEvents.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => setSelectedEvent(event)}
                    className={clsx(
                      'w-full text-left px-3 py-2.5 rounded-lg border transition-colors',
                      event.status === 'cancelled'
                        ? 'border-divider bg-bg-tertiary/50 opacity-60'
                        : 'border-divider bg-bg-tertiary hover:bg-bg-modifier-hover',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={clsx(
                          'w-2 h-2 rounded-full flex-shrink-0',
                          event.status === 'cancelled' ? 'bg-text-muted' : 'bg-brand-primary',
                        )}
                      />
                      <span
                        className={clsx(
                          'text-sm font-medium text-text-primary truncate',
                          event.status === 'cancelled' && 'line-through',
                        )}
                      >
                        {event.title}
                      </span>
                      {event.visibility === 'private' && (
                        <svg className="w-3.5 h-3.5 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-text-muted ml-4">
                      {formatEventTime(event.start_time)} — {formatEventTime(event.end_time)}
                      {event.rsvp_counts && (
                        <span className="ml-2">
                          {event.rsvp_counts.interested + event.rsvp_counts.tentative} going
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Event details modal */}
      {selectedEvent && (
        <EventDetailsModal
          event={selectedEvent}
          serverId={serverId}
          serverTimezone={serverTimezone}
          onClose={() => setSelectedEvent(null)}
          onEdit={(event) => {
            setSelectedEvent(null);
            setEditEvent(event);
            setShowCreateModal(true);
          }}
        />
      )}

      {/* Create/edit modal */}
      {showCreateModal && (
        <EventCreateModal
          serverId={serverId}
          onClose={() => {
            setShowCreateModal(false);
            setEditEvent(null);
          }}
          editEvent={editEvent}
          channels={channels}
        />
      )}
    </div>
  );
}
