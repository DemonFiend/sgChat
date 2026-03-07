import { useMemo } from 'react';
import { clsx } from 'clsx';
import type { ServerEvent } from '@sgchat/shared';

interface CalendarGridProps {
  year: number;
  month: number; // 1-12
  events: ServerEvent[];
  selectedDay: number | null;
  onSelectDay: (day: number) => void;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarGrid({ year, month, events, selectedDay, onSelectDay }: CalendarGridProps) {
  const { daysInMonth, startDayOfWeek, today } = useMemo(() => {
    const d = new Date(year, month, 0); // last day of month
    const firstDay = new Date(year, month - 1, 1).getDay();
    const now = new Date();
    return {
      daysInMonth: d.getDate(),
      startDayOfWeek: firstDay,
      today:
        now.getFullYear() === year && now.getMonth() + 1 === month ? now.getDate() : null,
    };
  }, [year, month]);

  const eventsByDay = useMemo(() => {
    const map = new Map<number, { scheduled: number; cancelled: number }>();
    for (const event of events) {
      const start = new Date(event.start_time);
      const end = new Date(event.end_time);
      // Mark all days the event spans within this month
      const firstDay = start.getFullYear() === year && start.getMonth() + 1 === month
        ? start.getDate()
        : 1;
      const lastDay = end.getFullYear() === year && end.getMonth() + 1 === month
        ? end.getDate()
        : daysInMonth;
      for (let d = firstDay; d <= lastDay; d++) {
        const entry = map.get(d) || { scheduled: 0, cancelled: 0 };
        if (event.status === 'cancelled') {
          entry.cancelled++;
        } else {
          entry.scheduled++;
        }
        map.set(d, entry);
      }
    }
    return map;
  }, [events, year, month, daysInMonth]);

  const cells: (number | null)[] = [];
  // Leading empty cells
  for (let i = 0; i < startDayOfWeek; i++) cells.push(null);
  // Day cells
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  // Trailing empty cells to fill last row
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="select-none">
      {/* Day name headers */}
      <div className="grid grid-cols-7 gap-px mb-1">
        {DAY_NAMES.map((name) => (
          <div key={name} className="text-center text-xs font-medium text-text-muted py-1">
            {name}
          </div>
        ))}
      </div>

      {/* Calendar cells */}
      <div className="grid grid-cols-7 gap-px">
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`empty-${i}`} className="aspect-square" />;
          }

          const dayEvents = eventsByDay.get(day);
          const isToday = day === today;
          const isSelected = day === selectedDay;

          return (
            <button
              key={day}
              onClick={() => onSelectDay(day)}
              className={clsx(
                'aspect-square flex flex-col items-center justify-center rounded-lg text-sm transition-colors relative',
                isSelected
                  ? 'bg-brand-primary text-white'
                  : isToday
                    ? 'bg-brand-primary/20 text-brand-primary font-semibold'
                    : 'hover:bg-bg-modifier-hover text-text-primary',
              )}
            >
              <span>{day}</span>
              {dayEvents && (
                <div className="flex gap-0.5 mt-0.5">
                  {dayEvents.scheduled > 0 && (
                    <div className="w-1.5 h-1.5 rounded-full bg-brand-primary" />
                  )}
                  {dayEvents.cancelled > 0 && (
                    <div className="w-1.5 h-1.5 rounded-full bg-text-muted" />
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
