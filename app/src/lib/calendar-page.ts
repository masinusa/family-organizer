import type { Request } from "express";
import { buildMonthGrid } from "./calendar-grid.js";
import { CATEGORY_NAME_MAX, listCategories, makeChipLookup, toChip } from "./categories.js";
import * as eventsRepo from "./events-repo.js";
import { eventFieldsData } from "./event-fields.js";
import { attendeeSummary, blankFormValues, formatDateInput } from "./event-input.js";
import { render } from "./render.js";
import * as usersRepo from "./users-repo.js";
import { isAdmin } from "../middleware/access-control.js";

export interface MonthSelection {
  year: number;
  month: number;
}

/** Falls back to the current month for anything missing or out of range. */
export function parseMonthQuery(query: Request["query"], now = new Date()): MonthSelection {
  const year = Number(query.year);
  const month = Number(query.month);
  return {
    year: Number.isInteger(year) && year >= 1970 && year <= 2200 ? year : now.getFullYear(),
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : now.getMonth() + 1,
  };
}

/**
 * Where a form should send the reader back to. Only the calendar itself,
 * optionally at a month — the value is re-built from parsed numbers rather
 * than echoed, so nothing else (an absolute URL, a protocol-relative
 * "//somewhere", a path with a fragment) can ride along.
 */
export function safeCalendarReturn(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const match = /^\/(?:\?year=(\d{1,4})&month=(\d{1,2}))?$/.exec(raw);
  if (!match) {
    return null;
  }
  if (!match[1]) {
    return "/";
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1970 || year > 2200 || month < 1 || month > 12) {
    return null;
  }
  return `/?year=${year}&month=${month}`;
}

/**
 * What day the "+ New event" button opens the quick-add modal on: today
 * when today is in the month being looked at, otherwise the 1st of it —
 * never a date that isn't on screen.
 */
export function defaultNewEventDate(year: number, month: number, today = new Date()): Date {
  const inView = today.getFullYear() === year && today.getMonth() === month - 1;
  return inView ? today : new Date(year, month - 1, 1);
}

/**
 * Shared by `GET /` and by `POST /categories` when the new category is
 * rejected, so a validation error re-renders the calendar the member was
 * looking at instead of bouncing them somewhere else.
 */
export async function renderCalendarPage(
  req: Request,
  selection: MonthSelection,
  categoryError: string | null = null,
): Promise<string> {
  const { year, month } = selection;
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);

  const [events, categories, members] = await Promise.all([
    eventsRepo.listInRange(monthStart, monthEnd),
    listCategories(),
    // Needed by the quick-add modal, which renders the same fields as the
    // full event form (views/_event-fields.eta).
    usersRepo.listUsers(),
  ]);
  const chips = categories.map(toChip);

  return render("calendar", {
    grid: buildMonthGrid(year, month, events),
    year,
    month,
    monthLabel: monthStart.toLocaleString(undefined, { month: "long", year: "numeric" }),
    prev: month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 },
    next: month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 },
    categories: chips,
    chipFor: makeChipLookup(categories),
    attendeeSummary,
    dateInput: formatDateInput,
    defaultDate: formatDateInput(defaultNewEventDate(year, month)),
    /** This very month — where the modals send the reader back to. */
    returnTo: `/?year=${year}&month=${month}`,
    nameMax: CATEGORY_NAME_MAX,
    // Quick-add modal — the same fields as the full-page form.
    ...eventFieldsData(
      blankFormValues(members.map((member) => member.email)),
      members,
      chips,
    ),
    categoryError,
    email: req.user?.email,
    isAdmin: isAdmin(req),
    active: "calendar",
  });
}
