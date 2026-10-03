import type { Attendee, EventDoc, EventInput, RsvpStatus } from "./types.js";

export const RSVP_STATUSES: RsvpStatus[] = ["invited", "yes", "maybe", "no"];

export const RSVP_LABELS: Record<RsvpStatus, string> = {
  invited: "Invited",
  yes: "Yes",
  maybe: "Maybe",
  no: "No",
};

/** The "not attached to this event at all" option in the per-member select. */
export const NOT_INVOLVED = "none";

/** Blank guest rows offered on top of the ones already on the event. */
export const SPARE_GUEST_ROWS = 3;

/** How many `guestName:<i>` keys a submission is scanned for. */
const MAX_GUEST_ROWS = 40;

export interface GuestRow {
  name: string;
  status: RsvpStatus;
}

export interface FormValues {
  id: string | null;
  title: string;
  description: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  link: string;
  categoryId: string;
  /** Keyed by family member email; value is an RsvpStatus or NOT_INVOLVED. */
  memberStatuses: Record<string, string>;
  guests: GuestRow[];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Formats a Date as the value an `<input type="date">` expects, in local time. */
export function formatDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Formats a Date as the value an `<input type="time">` expects, in local time. */
export function formatTimeInput(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isRsvpStatus(value: unknown): value is RsvpStatus {
  return typeof value === "string" && RSVP_STATUSES.includes(value as RsvpStatus);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Pads out to SPARE_GUEST_ROWS blank rows so there's always somewhere to
 * type another guest without any JavaScript. Blank rows are dropped on
 * parse, which is also how a guest gets removed: clear their name.
 */
function withSpareRows(guests: GuestRow[]): GuestRow[] {
  const kept = guests.filter((g) => g.name.trim() !== "");
  const spares: GuestRow[] = Array.from({ length: SPARE_GUEST_ROWS }, () => ({
    name: "",
    status: "invited" as RsvpStatus,
  }));
  return [...kept, ...spares];
}

export function formValuesFromEvent(event: EventDoc): FormValues {
  const memberStatuses: Record<string, string> = {};
  const guests: GuestRow[] = [];
  for (const attendee of event.attendees) {
    if (attendee.email) {
      memberStatuses[attendee.email] = attendee.status;
    } else if (attendee.name) {
      guests.push({ name: attendee.name, status: attendee.status });
    }
  }

  return {
    id: event.id,
    title: event.title,
    description: event.description ?? "",
    allDay: event.allDay,
    startDate: formatDateInput(event.startAt),
    startTime: formatTimeInput(event.startAt),
    endDate: formatDateInput(event.endAt),
    endTime: formatTimeInput(event.endAt),
    location: event.location ?? "",
    link: event.link ?? "",
    categoryId: event.categoryId ?? "",
    memberStatuses,
    guests: withSpareRows(guests),
  };
}

/**
 * `memberEmails` is the known family-member list, and the submission is read
 * by looking each one up — never by scanning the body for keys, so a crafted
 * field name can't attach a stranger to an event.
 */
export function formValuesFromBody(
  body: Record<string, unknown>,
  id: string | null,
  memberEmails: string[],
): FormValues {
  const memberStatuses: Record<string, string> = {};
  for (const email of memberEmails) {
    const value = asString(body[`memberStatus:${email}`]);
    if (isRsvpStatus(value)) {
      memberStatuses[email] = value;
    }
  }

  const guests: GuestRow[] = [];
  for (let i = 0; i < MAX_GUEST_ROWS; i += 1) {
    const name = asString(body[`guestName:${i}`]);
    if (name.trim() === "") {
      continue;
    }
    const status = asString(body[`guestStatus:${i}`]);
    guests.push({ name, status: isRsvpStatus(status) ? status : "invited" });
  }

  return {
    id,
    title: asString(body.title),
    description: asString(body.description),
    allDay: body.allDay === "on",
    startDate: asString(body.startDate),
    startTime: asString(body.startTime),
    endDate: asString(body.endDate),
    endTime: asString(body.endTime),
    location: asString(body.location),
    link: asString(body.link),
    categoryId: asString(body.categoryId),
    memberStatuses,
    guests: withSpareRows(guests),
  };
}

/**
 * A blank form, optionally opened on a particular day — what both
 * `GET /events/new?date=...` and the calendar's quick-add modal start from.
 * The default times are a convenience: most events aren't at midnight.
 */
export function blankFormValues(memberEmails: string[], date = ""): FormValues {
  const values = formValuesFromBody({}, null, memberEmails);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    values.startDate = date;
    values.endDate = date;
  }
  values.startTime = "09:00";
  values.endTime = "10:00";
  return values;
}

/**
 * Builds a local-time Date from an `<input type="date">` value plus either an
 * `<input type="time">` value or an all-day boundary. Component-wise rather
 * than via Date parsing so "2026-02-31" is rejected instead of rolling over
 * into March, and so no value is ever read as UTC.
 */
function parseDateTime(
  date: string,
  time: string,
  boundary: "start" | "end" | null,
): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!dateMatch) {
    return null;
  }
  const [year, month, day] = dateMatch.slice(1).map(Number) as [number, number, number];

  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  let ms = 0;
  if (boundary === "end") {
    [hours, minutes, seconds, ms] = [23, 59, 59, 999];
  } else if (boundary === null) {
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
    if (!timeMatch) {
      return null;
    }
    [hours, minutes] = timeMatch.slice(1).map(Number) as [number, number];
    if (hours > 23 || minutes > 59) {
      return null;
    }
  }

  const result = new Date(year, month - 1, day, hours, minutes, seconds, ms);
  // Rejects out-of-range days (Date would silently roll them forward).
  if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day) {
    return null;
  }
  return result;
}

/**
 * Empty → no link. A bare host gets `https://` prefixed so "maps.google.com"
 * works. Anything whose scheme isn't http(s) is rejected: Eta escapes the
 * attribute value, but escaping alone would not stop a `javascript:` href.
 */
export function parseLink(raw: string): { link: string | null } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { link: null };
  }
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { error: "That link doesn't look like a valid URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "Links must start with http:// or https://." };
  }
  return { link: url.toString() };
}

function attendeesFromValues(values: FormValues): Attendee[] {
  const members: Attendee[] = Object.entries(values.memberStatuses)
    .filter(([, status]) => isRsvpStatus(status))
    .map(([email, status]) => ({ email, name: null, status: status as RsvpStatus }));

  const seen = new Set<string>();
  const guests: Attendee[] = [];
  for (const guest of values.guests) {
    const name = guest.name.trim().replace(/\s+/g, " ");
    if (!name || seen.has(name.toLowerCase())) {
      continue;
    }
    seen.add(name.toLowerCase());
    guests.push({ email: null, name, status: guest.status });
  }

  return [...members, ...guests];
}

/**
 * All-day events are normalised to cover whole local days (00:00 through
 * 23:59:59.999) so the month grid can span them by calendar date without
 * caring what time was in the form when the box was ticked.
 */
export function parseEventInput(
  values: FormValues,
  validCategoryIds: string[],
): EventInput | { error: string } {
  const title = values.title.trim();
  if (!title) {
    return { error: "Title is required." };
  }

  const startAt = parseDateTime(values.startDate, values.startTime, values.allDay ? "start" : null);
  if (!startAt) {
    return {
      error: values.allDay
        ? "A valid start date is required."
        : "A valid start date and time are required.",
    };
  }

  // An all-day event that never got an end date is a single day.
  const endDate = values.endDate.trim() || values.startDate;
  const endAt = parseDateTime(endDate, values.endTime, values.allDay ? "end" : null);
  if (!endAt) {
    return {
      error: values.allDay
        ? "A valid end date is required."
        : "A valid end date and time are required.",
    };
  }
  if (endAt < startAt) {
    return { error: "The end must not be before the start." };
  }

  const link = parseLink(values.link);
  if ("error" in link) {
    return link;
  }

  const categoryId = values.categoryId.trim();
  if (categoryId && !validCategoryIds.includes(categoryId)) {
    return { error: "Pick a category from the list." };
  }

  return {
    title,
    description: values.description.trim() || null,
    startAt,
    endAt,
    allDay: values.allDay,
    location: values.location.trim() || null,
    link: link.link,
    categoryId: categoryId || null,
    attendees: attendeesFromValues(values),
  };
}

const DAY_FMT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
};
const TIME_FMT: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

function isSameLocalDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Human-readable span for the detail page — date-only when it's all-day. */
export function formatEventWhen(event: Pick<EventDoc, "startAt" | "endAt" | "allDay">): string {
  const startDay = event.startAt.toLocaleDateString(undefined, DAY_FMT);
  const sameDay = isSameLocalDate(event.startAt, event.endAt);

  if (event.allDay) {
    const endDay = event.endAt.toLocaleDateString(undefined, DAY_FMT);
    return sameDay ? `${startDay} · All day` : `${startDay} – ${endDay} · All day`;
  }

  const startTime = event.startAt.toLocaleTimeString(undefined, TIME_FMT);
  const endTime = event.endAt.toLocaleTimeString(undefined, TIME_FMT);
  if (sameDay) {
    return `${startDay}, ${startTime} – ${endTime}`;
  }
  return `${startDay}, ${startTime} – ${event.endAt.toLocaleDateString(undefined, DAY_FMT)}, ${endTime}`;
}

/** How a person reads on screen: a guest's name, or a member's email. */
export function attendeeLabel(attendee: Attendee): string {
  return attendee.name ?? attendee.email ?? "Someone";
}

/** One-line roster for a chip's `title` tooltip on the month grid. */
export function attendeeSummary(attendees: Attendee[]): string {
  if (attendees.length === 0) {
    return "";
  }
  return attendees.map((a) => `${attendeeLabel(a)} — ${RSVP_LABELS[a.status]}`).join("\n");
}

/** Yes first, then Maybe, No, and finally those yet to answer. */
const GROUP_ORDER: RsvpStatus[] = ["yes", "maybe", "no", "invited"];

export interface AttendeeGroup {
  status: RsvpStatus;
  label: string;
  people: Attendee[];
}

export function groupAttendees(attendees: Attendee[]): AttendeeGroup[] {
  return GROUP_ORDER.map((status) => ({
    status,
    label: RSVP_LABELS[status],
    people: attendees.filter((a) => a.status === status),
  })).filter((group) => group.people.length > 0);
}
