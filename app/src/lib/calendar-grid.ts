import type { EventDoc } from "./types.js";

/**
 * One event as it appears on one day's cell. The flags let the view draw a
 * multi-day event as a continuous bar — square corners where it carries on
 * into the next cell, rounded where it actually begins or ends.
 */
export interface DayEvent {
  event: EventDoc;
  isStart: boolean;
  isEnd: boolean;
  /** True when the event covers more than one day. */
  spans: boolean;
}

export interface CalendarDay {
  date: Date;
  dayOfMonth: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  /**
   * Fixed-height rows, in order. A `null` is an empty row held open by a
   * neighbouring day's bar — without it, a bar would jump up a row the day
   * after some other event ends and stop reading as one continuous run.
   */
  events: (DayEvent | null)[];
}

export type CalendarWeek = CalendarDay[];

interface EventRange {
  event: EventDoc;
  startKey: number;
  endKey: number;
}

/** y*10000 + m*100 + d — comparable and equatable without any time component. */
function dateKey(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

/**
 * Packs the events overlapping one week into rows, so an event keeps the
 * same row on every day of that week. Earliest-starting first, longest
 * first on a tie, so the longest runs settle at the top of the cells.
 */
function assignRows(week: CalendarDay[], ranges: EventRange[]): void {
  const weekStart = dateKey(week[0]!.date);
  const weekEnd = dateKey(week[week.length - 1]!.date);

  const inWeek = ranges
    .filter((range) => range.endKey >= weekStart && range.startKey <= weekEnd)
    .sort(
      (a, b) =>
        a.startKey - b.startKey ||
        b.endKey - b.startKey - (a.endKey - a.startKey) ||
        a.event.startAt.getTime() - b.event.startAt.getTime() ||
        a.event.id.localeCompare(b.event.id),
    );

  const rows: (DayEvent | null)[][] = [];
  for (const range of inWeek) {
    const dayIndexes = week
      .map((day, index) => ({ key: dateKey(day.date), index }))
      .filter(({ key }) => key >= range.startKey && key <= range.endKey)
      .map(({ index }) => index);

    let row = rows.findIndex((cells) => dayIndexes.every((index) => cells[index] === null));
    if (row === -1) {
      rows.push(Array.from({ length: week.length }, () => null));
      row = rows.length - 1;
    }
    for (const index of dayIndexes) {
      rows[row]![index] = {
        event: range.event,
        isStart: dateKey(week[index]!.date) === range.startKey,
        isEnd: dateKey(week[index]!.date) === range.endKey,
        spans: range.startKey !== range.endKey,
      };
    }
  }

  week.forEach((day, index) => {
    const column = rows.map((cells) => cells[index]!);
    // Trailing empties would just pad the cell for no reason.
    while (column.length > 0 && column[column.length - 1] === null) {
      column.pop();
    }
    day.events = column;
  });
}

/**
 * Builds a full-week grid (Sun-Sat rows) covering `month` (1-indexed),
 * padded with adjacent-month days so every row has 7 entries.
 *
 * An event is bucketed onto every day its [startAt, endAt] range covers, by
 * local calendar date — so a four-day visit appears on all four days, not
 * only the day it started.
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

  const ranges: EventRange[] = events.map((event) => ({
    event,
    startKey: dateKey(event.startAt),
    endKey: dateKey(event.endAt),
  }));

  const weeks: CalendarWeek[] = [];
  let week: CalendarDay[] = [];
  const cursor = new Date(gridStart);
  const todayKey = dateKey(today);

  while (cursor <= gridEnd) {
    const date = new Date(cursor);
    week.push({
      date,
      dayOfMonth: date.getDate(),
      inCurrentMonth: date.getMonth() === month - 1 && date.getFullYear() === year,
      isToday: dateKey(date) === todayKey,
      events: [],
    });
    if (week.length === 7) {
      assignRows(week, ranges);
      weeks.push(week);
      week = [];
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return weeks;
}
