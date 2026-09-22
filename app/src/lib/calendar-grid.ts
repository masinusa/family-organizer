import type { EventDoc } from "./types.js";

export interface CalendarDay {
  date: Date;
  dayOfMonth: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  events: EventDoc[];
}

export type CalendarWeek = CalendarDay[];

function isSameDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Builds a full-week grid (Sun-Sat rows) covering `month` (1-indexed),
 * padded with adjacent-month days so every row has 7 entries. Events are
 * bucketed by `startAt`'s local calendar date only — a multi-day event
 * appears only on its start day.
 */
export function buildMonthGrid(
  year: number,
  month: number,
  events: EventDoc[],
  today: Date = new Date(),
): CalendarWeek[] {
  const firstOfMonth = new Date(year, month - 1, 1);
  const lastOfMonth = new Date(year, month, 0);
  const gridStart = new Date(year, month - 1, 1 - firstOfMonth.getDay());
  const gridEnd = new Date(year, month - 1, lastOfMonth.getDate() + (6 - lastOfMonth.getDay()));

  const weeks: CalendarWeek[] = [];
  let week: CalendarDay[] = [];
  const cursor = new Date(gridStart);

  while (cursor <= gridEnd) {
    const date = new Date(cursor);
    week.push({
      date,
      dayOfMonth: date.getDate(),
      inCurrentMonth: date.getMonth() === month - 1 && date.getFullYear() === year,
      isToday: isSameDate(date, today),
      events: events.filter((event) => isSameDate(event.startAt, date)),
    });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return weeks;
}
