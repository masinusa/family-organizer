import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMonthGrid } from "../src/lib/calendar-grid.js";
import { defaultNewEventDate } from "../src/lib/calendar-page.js";
import type { EventDoc } from "../src/lib/types.js";

function makeEvent(overrides: Partial<EventDoc> = {}): EventDoc {
  return {
    id: "evt-1",
    title: "Test event",
    description: null,
    startAt: new Date(2026, 8, 21, 10, 0),
    endAt: new Date(2026, 8, 21, 11, 0),
    allDay: false,
    location: null,
    link: null,
    categoryId: null,
    attendees: [],
    recurrenceRule: null,
    createdBy: "someone@example.com",
    createdAt: new Date(2026, 8, 1),
    updatedAt: new Date(2026, 8, 1),
    ...overrides,
  };
}

function dayIn(grid: ReturnType<typeof buildMonthGrid>, dayOfMonth: number) {
  return grid.flat().find((day) => day.inCurrentMonth && day.dayOfMonth === dayOfMonth)!;
}

test("builds full weeks padded with adjacent-month days", () => {
  // September 2026: 1st is a Tuesday, 30th is a Wednesday.
  const grid = buildMonthGrid(2026, 9, []);

  assert.equal(grid.length, 5);
  grid.forEach((week) => assert.equal(week.length, 7));

  const firstWeek = grid[0]!;
  assert.equal(firstWeek[0]!.inCurrentMonth, false); // Sun Aug 30
  assert.equal(firstWeek[2]!.inCurrentMonth, true); // Tue Sep 1
  assert.equal(firstWeek[2]!.dayOfMonth, 1);

  const lastWeek = grid[grid.length - 1]!;
  assert.equal(lastWeek[3]!.inCurrentMonth, true); // Wed Sep 30
  assert.equal(lastWeek[3]!.dayOfMonth, 30);
  assert.equal(lastWeek[6]!.inCurrentMonth, false); // Sat Oct 3
});

test("handles a leap-year February correctly", () => {
  // 2028 is a leap year: Feb has 29 days.
  const grid = buildMonthGrid(2028, 2, []);
  const allDays = grid.flat();
  const feb29 = allDays.find((day) => day.inCurrentMonth && day.dayOfMonth === 29);

  assert.ok(feb29, "Feb 29 should appear in the grid");
  assert.equal(feb29!.date.getMonth(), 1);
});

test("buckets a single-day event onto its start-date cell only", () => {
  const event = makeEvent({
    startAt: new Date(2026, 8, 21, 9, 30),
    endAt: new Date(2026, 8, 21, 17, 0),
  });
  const grid = buildMonthGrid(2026, 9, [event]);

  const day21 = dayIn(grid, 21);
  assert.equal(day21.events.length, 1);
  assert.deepEqual(day21.events[0], { event, isStart: true, isEnd: true, spans: false });

  const otherDays = grid.flat().filter((day) => day !== day21);
  otherDays.forEach((day) => assert.deepEqual(day.events, []));
});

test("spans a multi-day event across every day it covers", () => {
  const event = makeEvent({
    title: "Grandparents visiting",
    startAt: new Date(2026, 8, 20, 14, 0),
    endAt: new Date(2026, 8, 23, 11, 0),
  });
  const grid = buildMonthGrid(2026, 9, [event]);

  const covered = [20, 21, 22, 23].map((n) => dayIn(grid, n));
  covered.forEach((day) => assert.equal(day.events.length, 1, `day ${day.dayOfMonth}`));

  assert.deepEqual(
    covered.map((day) => day.events[0]!.isStart),
    [true, false, false, false],
  );
  assert.deepEqual(
    covered.map((day) => day.events[0]!.isEnd),
    [false, false, false, true],
  );
  covered.forEach((day) => assert.equal(day.events[0]!.spans, true));

  assert.deepEqual(dayIn(grid, 19).events, []);
  assert.deepEqual(dayIn(grid, 24).events, []);
});

test("shows an event that started in the previous month", () => {
  // Starts Aug 30, ends Sep 2 — nothing about it starts inside September.
  const event = makeEvent({
    startAt: new Date(2026, 7, 30, 9, 0),
    endAt: new Date(2026, 8, 2, 18, 0),
  });
  const grid = buildMonthGrid(2026, 9, [event]);

  const sep1 = dayIn(grid, 1);
  assert.equal(sep1.events.length, 1);
  assert.equal(sep1.events[0]!.isStart, false);
  assert.equal(sep1.events[0]!.isEnd, false);

  const sep2 = dayIn(grid, 2);
  assert.equal(sep2.events[0]!.isEnd, true);
  assert.deepEqual(dayIn(grid, 3).events, []);
});

test("sorts multi-day events ahead of single-day ones", () => {
  const trip = makeEvent({
    id: "trip",
    startAt: new Date(2026, 8, 20, 12, 0),
    endAt: new Date(2026, 8, 22, 12, 0),
  });
  // Starts earlier in the day, but shouldn't push the running trip down.
  const dinner = makeEvent({
    id: "dinner",
    startAt: new Date(2026, 8, 21, 8, 0),
    endAt: new Date(2026, 8, 21, 9, 0),
  });
  const grid = buildMonthGrid(2026, 9, [dinner, trip]);

  assert.deepEqual(
    dayIn(grid, 21).events.map((item) => item.event.id),
    ["trip", "dinner"],
  );
});

test("marks isToday only for the matching date", () => {
  const today = new Date(2026, 8, 21);
  const grid = buildMonthGrid(2026, 9, [], today);
  const allDays = grid.flat();

  const todayCells = allDays.filter((day) => day.isToday);
  assert.equal(todayCells.length, 1);
  assert.equal(todayCells[0]!.dayOfMonth, 21);
});

test("holds a row open so a running bar doesn't jump up a line", () => {
  // Thanksgiving ends on the Sunday the week starts; the visit runs on
  // through Wednesday. Once Thanksgiving is gone, the visit must stay on
  // its own row rather than sliding up into the vacated one.
  const thanksgiving = makeEvent({
    id: "thanksgiving",
    startAt: new Date(2026, 10, 26, 0, 0),
    endAt: new Date(2026, 10, 29, 23, 59, 59, 999),
  });
  const visit = makeEvent({
    id: "visit",
    startAt: new Date(2026, 10, 28, 0, 0),
    endAt: new Date(2026, 11, 2, 23, 59, 59, 999),
  });
  const lastWeek = buildMonthGrid(2026, 11, [thanksgiving, visit]).at(-1)!;

  // Sun Nov 29 through Wed Dec 2.
  assert.deepEqual(
    lastWeek.slice(0, 4).map((day) => day.events.map((item) => item?.event.id ?? null)),
    [
      ["thanksgiving", "visit"],
      [null, "visit"],
      [null, "visit"],
      [null, "visit"],
    ],
  );
  // Nothing is left padding the cells once the bar has ended.
  assert.deepEqual(lastWeek[4]!.events, []);
});

test("packs independent events into the first free row", () => {
  const early = makeEvent({ id: "early", startAt: new Date(2026, 8, 7), endAt: new Date(2026, 8, 8) });
  const later = makeEvent({ id: "later", startAt: new Date(2026, 8, 10), endAt: new Date(2026, 8, 11) });
  const week = buildMonthGrid(2026, 9, [early, later])[1]!;

  // They don't overlap, so both sit on the top row — no wasted space.
  assert.deepEqual(
    week.map((day) => day.events.map((item) => item?.event.id ?? null)),
    [[], ["early"], ["early"], [], ["later"], ["later"], []],
  );
});

test('"+ New event" opens on a day that is actually on screen', () => {
  const today = new Date(2026, 9, 3);

  // Looking at the current month: today itself.
  assert.deepEqual(defaultNewEventDate(2026, 10, today), today);
  // Looking at any other month: its 1st, never an off-screen date.
  assert.deepEqual(defaultNewEventDate(2026, 11, today), new Date(2026, 10, 1));
  assert.deepEqual(defaultNewEventDate(2025, 10, today), new Date(2025, 9, 1));
});
