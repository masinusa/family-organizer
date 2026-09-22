import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMonthGrid } from "../src/lib/calendar-grid.js";
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
    recurrenceRule: null,
    createdBy: "someone@example.com",
    createdAt: new Date(2026, 8, 1),
    updatedAt: new Date(2026, 8, 1),
    ...overrides,
  };
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

test("buckets an event onto its start-date cell", () => {
  const event = makeEvent({ startAt: new Date(2026, 8, 21, 9, 30) });
  const grid = buildMonthGrid(2026, 9, [event]);
  const allDays = grid.flat();

  const day21 = allDays.find((day) => day.inCurrentMonth && day.dayOfMonth === 21);
  assert.deepEqual(day21!.events, [event]);

  const otherDays = allDays.filter((day) => day !== day21);
  otherDays.forEach((day) => assert.deepEqual(day.events, []));
});

test("marks isToday only for the matching date", () => {
  const today = new Date(2026, 8, 21);
  const grid = buildMonthGrid(2026, 9, [], today);
  const allDays = grid.flat();

  const todayCells = allDays.filter((day) => day.isToday);
  assert.equal(todayCells.length, 1);
  assert.equal(todayCells[0]!.dayOfMonth, 21);
});
