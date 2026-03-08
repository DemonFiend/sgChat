import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import type { ServerEvent } from '@sgchat/shared';
import { useEventsStore } from '@/stores/events';
import { api } from '@/api';

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

const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DURATION_PRESETS = [
  { label: '1h', minutes: 60 },
  { label: '1.5h', minutes: 90 },
  { label: '2h', minutes: 120 },
  { label: '3h', minutes: 180 },
  { label: '4h', minutes: 240 },
  { label: '8h', minutes: 480 },
  { label: '1d', minutes: 1440 },
  { label: '2d', minutes: 2880 },
  { label: '1w', minutes: 10080 },
  { label: '1mo', minutes: 43200 },
];

const MAX_DURATION_MINUTES = 5 * 365.25 * 24 * 60; // ~5 years

function getToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getNextHour(): { hour: number; minute: number } {
  const now = new Date();
  return { hour: (now.getHours() + 1) % 24, minute: 0 };
}

function toMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function to12Hour(h24: number): { hour12: number; ampm: 'AM' | 'PM' } {
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  let hour12 = h24 % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, ampm };
}

function to24Hour(hour12: number, ampm: 'AM' | 'PM'): number {
  if (ampm === 'AM') return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

function buildDatetime(day: Date, hour: number, minute: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ── Mini Calendar ──

function MiniCalendar({
  monthKey,
  onMonthChange,
  selectedDay,
  onSelectDay,
  minDate,
}: {
  monthKey: string;
  onMonthChange: (key: string) => void;
  selectedDay: Date | null;
  onSelectDay: (day: Date) => void;
  minDate: Date;
}) {
  const [year, month] = useMemo(() => {
    const [y, m] = monthKey.split('-').map(Number);
    return [y, m];
  }, [monthKey]);

  const { daysInMonth, startDayOfWeek, todayDate } = useMemo(() => {
    const d = new Date(year, month, 0);
    const firstDay = new Date(year, month - 1, 1).getDay();
    const now = new Date();
    return {
      daysInMonth: d.getDate(),
      startDayOfWeek: firstDay,
      todayDate: now.getFullYear() === year && now.getMonth() + 1 === month ? now.getDate() : null,
    };
  }, [year, month]);

  const minMonthKey = toMonthKey(minDate);
  const canGoPrev = monthKey > minMonthKey;

  const navigateMonth = (delta: number) => {
    let newMonth = month + delta;
    let newYear = year;
    if (newMonth < 1) { newMonth = 12; newYear--; }
    else if (newMonth > 12) { newMonth = 1; newYear++; }
    const key = `${newYear}-${String(newMonth).padStart(2, '0')}`;
    if (key >= minMonthKey) onMonthChange(key);
  };

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-1.5">
        <button
          type="button"
          onClick={() => navigateMonth(-1)}
          disabled={!canGoPrev}
          className="p-1 rounded hover:bg-bg-modifier-hover text-text-muted hover:text-text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xs font-semibold text-text-primary">
          {MONTH_NAMES[month - 1]} {year}
        </span>
        <button
          type="button"
          onClick={() => navigateMonth(1)}
          className="p-1 rounded hover:bg-bg-modifier-hover text-text-muted hover:text-text-primary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px mb-0.5">
        {DAY_NAMES.map((name) => (
          <div key={name} className="text-center text-[10px] font-medium text-text-muted py-0.5">
            {name}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px">
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`e-${i}`} className="w-7 h-7" />;
          }

          const thisDate = new Date(year, month - 1, day);
          const isPast = thisDate < minDate;
          const isSelected = selectedDay && sameDay(thisDate, selectedDay);
          const isToday = day === todayDate;

          return (
            <button
              key={day}
              type="button"
              disabled={isPast}
              onClick={() => onSelectDay(thisDate)}
              className={clsx(
                'w-7 h-7 rounded text-xs flex items-center justify-center transition-colors',
                isPast && 'opacity-30 pointer-events-none text-text-muted',
                isSelected
                  ? 'bg-brand-primary text-white font-semibold'
                  : isToday
                    ? 'bg-brand-primary/20 text-brand-primary font-semibold'
                    : 'hover:bg-bg-modifier-hover text-text-primary',
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Time Picker ──

function TimePicker({
  hour,
  minute,
  onChange,
}: {
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
}) {
  const { hour12, ampm } = to12Hour(hour);

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={hour12}
        onChange={(e) => onChange(to24Hour(Number(e.target.value), ampm), minute)}
        className="px-1.5 py-1 bg-bg-tertiary border border-divider rounded text-xs text-text-primary focus:outline-none focus:border-brand-primary"
      >
        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <span className="text-text-muted text-xs">:</span>
      <select
        value={minute}
        onChange={(e) => onChange(hour, Number(e.target.value))}
        className="px-1.5 py-1 bg-bg-tertiary border border-divider rounded text-xs text-text-primary focus:outline-none focus:border-brand-primary"
      >
        {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
          <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
        ))}
      </select>
      <div className="flex rounded overflow-hidden border border-divider">
        <button
          type="button"
          onClick={() => onChange(to24Hour(hour12, 'AM'), minute)}
          className={clsx(
            'px-1.5 py-1 text-[10px] font-medium transition-colors',
            ampm === 'AM'
              ? 'bg-brand-primary text-white'
              : 'bg-bg-tertiary text-text-muted hover:text-text-primary',
          )}
        >
          AM
        </button>
        <button
          type="button"
          onClick={() => onChange(to24Hour(hour12, 'PM'), minute)}
          className={clsx(
            'px-1.5 py-1 text-[10px] font-medium transition-colors',
            ampm === 'PM'
              ? 'bg-brand-primary text-white'
              : 'bg-bg-tertiary text-text-muted hover:text-text-primary',
          )}
        >
          PM
        </button>
      </div>
    </div>
  );
}

// ── Main Modal ──

export function EventCreateModal({
  serverId,
  onClose,
  editEvent,
  channels,
}: EventCreateModalProps) {
  const createEvent = useEventsStore((s) => s.createEvent);
  const updateEvent = useEventsStore((s) => s.updateEvent);

  const today = useMemo(() => getToday(), []);
  const isEditing = !!editEvent;

  // Parse edit event or use defaults
  const initStart = useMemo(() => {
    if (editEvent?.start_time) {
      const d = new Date(editEvent.start_time);
      return { day: new Date(d.getFullYear(), d.getMonth(), d.getDate()), hour: d.getHours(), minute: Math.floor(d.getMinutes() / 5) * 5 };
    }
    const { hour, minute } = getNextHour();
    return { day: today, hour, minute };
  }, [editEvent, today]);

  const initEnd = useMemo(() => {
    if (editEvent?.end_time) {
      const d = new Date(editEvent.end_time);
      return { day: new Date(d.getFullYear(), d.getMonth(), d.getDate()), hour: d.getHours(), minute: Math.floor(d.getMinutes() / 5) * 5 };
    }
    const endH = (initStart.hour + 1) % 24;
    const endDay = endH < initStart.hour ? new Date(initStart.day.getTime() + 86400000) : new Date(initStart.day);
    return { day: endDay, hour: endH, minute: 0 };
  }, [editEvent, initStart]);

  const [title, setTitle] = useState(editEvent?.title || '');
  const [description, setDescription] = useState(editEvent?.description || '');

  // Date/time state
  const [startDay, setStartDay] = useState<Date>(initStart.day);
  const [startHour, setStartHour] = useState(initStart.hour);
  const [startMinute, setStartMinute] = useState(initStart.minute);
  const [endDay, setEndDay] = useState<Date>(initEnd.day);
  const [endHour, setEndHour] = useState(initEnd.hour);
  const [endMinute, setEndMinute] = useState(initEnd.minute);

  // Calendar view state
  const [startCalMonth, setStartCalMonth] = useState(toMonthKey(initStart.day));
  const [endCalMonth, setEndCalMonth] = useState(toMonthKey(initEnd.day));

  const [announceAtStart, setAnnounceAtStart] = useState(editEvent?.announce_at_start ?? true);
  const [announcementChannelId, setAnnouncementChannelId] = useState(
    editEvent?.announcement_channel_id || '',
  );
  const [visibility, setVisibility] = useState<'public' | 'private'>(
    editEvent?.visibility || 'public',
  );
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>(
    editEvent?.visible_role_ids || [],
  );
  const [roles, setRoles] = useState<{ id: string; name: string; color: string | null }[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openCal, setOpenCal] = useState<'start' | 'end' | null>(null);

  // Auto-adjust end when start changes (only for new events)
  useEffect(() => {
    if (isEditing) return;
    const startDt = buildDatetime(startDay, startHour, startMinute);
    const endDt = buildDatetime(endDay, endHour, endMinute);
    if (endDt <= startDt) {
      const newEnd = new Date(startDt.getTime() + 3600000);
      setEndDay(new Date(newEnd.getFullYear(), newEnd.getMonth(), newEnd.getDate()));
      setEndHour(newEnd.getHours());
      setEndMinute(newEnd.getMinutes());
      setEndCalMonth(toMonthKey(newEnd));
    }
  }, [startDay, startHour, startMinute, isEditing]);

  // Fetch server roles when visibility is set to private
  useEffect(() => {
    if (visibility === 'private' && roles.length === 0) {
      api
        .get<{ id: string; name: string; color: string | null }[]>('/roles')
        .then((data) => setRoles(data.filter((r) => r.name !== '@everyone')))
        .catch(() => {});
    }
  }, [visibility, roles.length]);

  const textChannels = channels.filter(
    (c) => c.type === 'text' || c.type === 'announcement',
  );

  const applyDurationPreset = (minutes: number) => {
    const startDt = buildDatetime(startDay, startHour, startMinute);
    const endDt = new Date(startDt.getTime() + minutes * 60000);
    setEndDay(new Date(endDt.getFullYear(), endDt.getMonth(), endDt.getDate()));
    setEndHour(endDt.getHours());
    setEndMinute(Math.floor(endDt.getMinutes() / 5) * 5);
    setEndCalMonth(toMonthKey(endDt));
  };

  // Summary text for selected dates/times
  const startSummary = useMemo(() => {
    const d = buildDatetime(startDay, startHour, startMinute);
    return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }, [startDay, startHour, startMinute]);

  const endSummary = useMemo(() => {
    const d = buildDatetime(endDay, endHour, endMinute);
    return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }, [endDay, endHour, endMinute]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    const startDate = buildDatetime(startDay, startHour, startMinute);
    const endDate = buildDatetime(endDay, endHour, endMinute);

    if (endDate <= startDate) {
      setError('End time must be after start time');
      return;
    }

    const durationMin = (endDate.getTime() - startDate.getTime()) / 60000;
    if (durationMin > MAX_DURATION_MINUTES) {
      setError('Event duration cannot exceed 5 years');
      return;
    }

    if (!isEditing && startDate < new Date()) {
      setError('Start time cannot be in the past');
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
        role_ids: visibility === 'private' ? selectedRoleIds : undefined,
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
          className="bg-bg-secondary rounded-xl border border-divider shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <form onSubmit={handleSubmit} className="flex flex-col h-full">
            <div className="px-5 pt-5 pb-3">
              <h2 className="text-lg font-semibold text-text-primary">
                {isEditing ? 'Edit Event' : 'Create Event'}
              </h2>
            </div>

            <div className="px-5 py-3 space-y-4 overflow-y-auto flex-1">
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
                  rows={2}
                  className="w-full px-3 py-2 bg-bg-tertiary border border-divider rounded text-sm text-text-primary focus:outline-none focus:border-brand-primary resize-none"
                  placeholder="Optional description"
                />
              </div>

              {/* Start Date + Time */}
              <div>
                <button
                  type="button"
                  onClick={() => setOpenCal(openCal === 'start' ? null : 'start')}
                  className="w-full flex items-center justify-between mb-1.5 group"
                >
                  <div className="flex items-center gap-1.5">
                    <svg className={clsx('w-3 h-3 text-text-muted transition-transform', openCal === 'start' && 'rotate-90')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-xs font-medium text-text-muted uppercase">Start *</span>
                  </div>
                  <span className="text-xs text-text-secondary">{startSummary}</span>
                </button>

                <div className="flex items-center gap-2 mb-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setStartDay(today);
                      setStartCalMonth(toMonthKey(today));
                    }}
                    className="px-2 py-0.5 text-[10px] font-medium rounded bg-bg-tertiary text-text-secondary hover:bg-bg-modifier-hover transition-colors border border-divider"
                  >
                    Today
                  </button>
                  <TimePicker
                    hour={startHour}
                    minute={startMinute}
                    onChange={(h, m) => { setStartHour(h); setStartMinute(m); }}
                  />
                </div>

                {openCal === 'start' && (
                  <div className="bg-bg-tertiary border border-divider rounded-lg p-3">
                    <MiniCalendar
                      monthKey={startCalMonth}
                      onMonthChange={setStartCalMonth}
                      selectedDay={startDay}
                      onSelectDay={(day) => {
                        setStartDay(day);
                        if (endDay < day) {
                          setEndDay(day);
                          setEndCalMonth(toMonthKey(day));
                        }
                        setOpenCal(null);
                      }}
                      minDate={isEditing ? new Date(0) : today}
                    />
                  </div>
                )}
              </div>

              {/* End Date + Time */}
              <div>
                <button
                  type="button"
                  onClick={() => setOpenCal(openCal === 'end' ? null : 'end')}
                  className="w-full flex items-center justify-between mb-1.5 group"
                >
                  <div className="flex items-center gap-1.5">
                    <svg className={clsx('w-3 h-3 text-text-muted transition-transform', openCal === 'end' && 'rotate-90')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-xs font-medium text-text-muted uppercase">End</span>
                  </div>
                  <span className="text-xs text-text-secondary">{endSummary}</span>
                </button>

                <div className="flex items-center gap-2 mb-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setEndDay(new Date(startDay));
                      setEndCalMonth(toMonthKey(startDay));
                    }}
                    className="px-2 py-0.5 text-[10px] font-medium rounded bg-bg-tertiary text-text-secondary hover:bg-bg-modifier-hover transition-colors border border-divider"
                  >
                    Same Day
                  </button>
                  <TimePicker
                    hour={endHour}
                    minute={endMinute}
                    onChange={(h, m) => { setEndHour(h); setEndMinute(m); }}
                  />
                </div>

                {/* Duration presets */}
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {DURATION_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => applyDurationPreset(preset.minutes)}
                      className="px-2 py-0.5 text-[10px] font-medium rounded bg-bg-tertiary text-text-secondary hover:bg-brand-primary hover:text-white transition-colors border border-divider"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {openCal === 'end' && (
                  <div className="bg-bg-tertiary border border-divider rounded-lg p-3">
                    <MiniCalendar
                      monthKey={endCalMonth}
                      onMonthChange={setEndCalMonth}
                      selectedDay={endDay}
                      onSelectDay={(day) => {
                        setEndDay(day);
                        setOpenCal(null);
                      }}
                      minDate={startDay}
                    />
                  </div>
                )}
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

              {/* Role selector for private events */}
              {visibility === 'private' && roles.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-text-muted uppercase mb-1">
                    Visible to Roles
                  </label>
                  <div className="max-h-32 overflow-y-auto space-y-1 bg-bg-tertiary border border-divider rounded p-2">
                    {roles.map((role) => (
                      <label key={role.id} className="flex items-center gap-2 cursor-pointer py-0.5">
                        <input
                          type="checkbox"
                          checked={selectedRoleIds.includes(role.id)}
                          onChange={(e) => {
                            setSelectedRoleIds((prev) =>
                              e.target.checked
                                ? [...prev, role.id]
                                : prev.filter((id) => id !== role.id),
                            );
                          }}
                          className="w-3.5 h-3.5 rounded border-divider bg-bg-primary accent-brand-primary"
                        />
                        <span
                          className="text-sm"
                          style={{ color: role.color || 'var(--text-secondary)' }}
                        >
                          {role.name}
                        </span>
                      </label>
                    ))}
                  </div>
                  {selectedRoleIds.length === 0 && (
                    <p className="text-xs text-text-muted mt-1">
                      No roles selected — only you and event managers will see this event.
                    </p>
                  )}
                </div>
              )}
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
