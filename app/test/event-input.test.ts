import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attendeeSummary,
  blankFormValues,
  formValuesFromBody,
  formValuesFromEvent,
  formatEventWhen,
  groupAttendees,
  parseEventInput,
  parseLink,
  type FormValues,
} from "../src/lib/event-input.js";
import type { Attendee, EventDoc } from "../src/lib/types.js";

const CATEGORY_IDS = ["holiday", "trip"];

function makeValues(overrides: Partial<FormValues> = {}): FormValues {
  return {
    id: null,
    title: "Thanksgiving",
    description: "",
    allDay: false,
    startDate: "2026-11-26",
    startTime: "14:00",
    endDate: "2026-11-26",
    endTime: "18:00",
    location: "",
    link: "",
    categoryId: "",
    memberStatuses: {},
    guests: [],
    ...overrides,
  };
}

function parse(overrides: Partial<FormValues> = {}) {
  return parseEventInput(makeValues(overrides), CATEGORY_IDS);
}

function makeEvent(overrides: Partial<EventDoc> = {}): EventDoc {
  return {
    id: "evt-1",
    title: "Thanksgiving",
    description: "Bring pie",
    startAt: new Date(2026, 10, 26, 14, 0),
    endAt: new Date(2026, 10, 26, 18, 0),
    allDay: false,
    location: "Nana's",
    link: "https://example.com/menu",
    categoryId: "holiday",
    attendees: [],
    recurrenceRule: null,
    createdBy: "me@example.com",
    createdAt: new Date(2026, 9, 1),
    updatedAt: new Date(2026, 9, 1),
    ...overrides,
  };
}

test("combines the date and time fields in local time", () => {
  const parsed = parse();
  assert.ok(!("error" in parsed));
  assert.deepEqual(parsed.startAt, new Date(2026, 10, 26, 14, 0));
  assert.deepEqual(parsed.endAt, new Date(2026, 10, 26, 18, 0));
  assert.equal(parsed.allDay, false);
});

test("an all-day event covers whole local days and ignores the time fields", () => {
  const parsed = parse({ allDay: true, startTime: "14:00", endTime: "18:00", endDate: "2026-11-29" });
  assert.ok(!("error" in parsed));
  assert.deepEqual(parsed.startAt, new Date(2026, 10, 26, 0, 0, 0, 0));
  assert.deepEqual(parsed.endAt, new Date(2026, 10, 29, 23, 59, 59, 999));
});

test("an all-day event with no end date is a single day", () => {
  const parsed = parse({ allDay: true, endDate: "" });
  assert.ok(!("error" in parsed));
  assert.deepEqual(parsed.startAt, new Date(2026, 10, 26, 0, 0, 0, 0));
  assert.deepEqual(parsed.endAt, new Date(2026, 10, 26, 23, 59, 59, 999));
});

test("rejects missing, malformed and out-of-range dates", () => {
  assert.deepEqual(parse({ title: "   " }), { error: "Title is required." });
  assert.ok("error" in parse({ startDate: "" }));
  assert.ok("error" in parse({ startDate: "26/11/2026" }));
  // Date would roll 2026-02-31 forward to March 3 rather than complain.
  assert.ok("error" in parse({ startDate: "2026-02-31" }));
  assert.ok("error" in parse({ startTime: "" }));
  assert.ok("error" in parse({ startTime: "25:00" }));
  assert.deepEqual(parse({ endDate: "2026-11-25" }), {
    error: "The end must not be before the start.",
  });
});

test("parseLink prefixes a bare host and refuses non-http schemes", () => {
  assert.deepEqual(parseLink("  "), { link: null });
  assert.deepEqual(parseLink("maps.google.com/x"), { link: "https://maps.google.com/x" });
  assert.deepEqual(parseLink("http://example.com/a"), { link: "http://example.com/a" });
  assert.ok("error" in parseLink("javascript:alert(1)"));
  assert.ok("error" in parseLink("data:text/html,<script>"));
  assert.ok("error" in parseLink("https://"));
});

test("only accepts a category that actually exists", () => {
  const ok = parse({ categoryId: "trip" });
  assert.ok(!("error" in ok));
  assert.equal(ok.categoryId, "trip");

  const blank = parse({ categoryId: "" });
  assert.ok(!("error" in blank));
  assert.equal(blank.categoryId, null);

  assert.deepEqual(parse({ categoryId: "made-up" }), { error: "Pick a category from the list." });
});

test("builds attendees from member statuses and guest rows", () => {
  const parsed = parse({
    memberStatuses: { "a@example.com": "yes", "b@example.com": "maybe" },
    guests: [
      { name: "  Aunt   Jo ", status: "yes" },
      { name: "", status: "invited" },
      { name: "aunt jo", status: "no" },
      { name: "Cousin Pat", status: "invited" },
    ],
  });
  assert.ok(!("error" in parsed));
  assert.deepEqual(parsed.attendees, [
    { email: "a@example.com", name: null, status: "yes" },
    { email: "b@example.com", name: null, status: "maybe" },
    // Whitespace collapsed, blank row dropped, duplicate name ignored.
    { email: null, name: "Aunt Jo", status: "yes" },
    { email: null, name: "Cousin Pat", status: "invited" },
  ]);
});

test("a member is attached only when their involved box is ticked", () => {
  const body = {
    "involved:member@example.com": "on",
    "memberStatus:member@example.com": "yes",
    // The roster renders a status control for everyone, so a status with
    // no involved box must not put someone on the event.
    "memberStatus:bystander@example.com": "yes",
    // Ticked but unanswered, and ticked with a status that isn't one.
    "involved:asked@example.com": "on",
    "involved:odd@example.com": "on",
    "memberStatus:odd@example.com": "definitely",
    // Not a family member at all — a crafted field name can't add them.
    "involved:stranger@example.com": "on",
    "memberStatus:stranger@example.com": "yes",
  };
  const values = formValuesFromBody(body, null, [
    "member@example.com",
    "bystander@example.com",
    "asked@example.com",
    "odd@example.com",
  ]);

  assert.deepEqual(values.memberStatuses, {
    "member@example.com": "yes",
    "asked@example.com": "invited",
    "odd@example.com": "invited",
  });
});

test("an event round-trips into the form it was made from", () => {
  const attendees: Attendee[] = [
    { email: "a@example.com", name: null, status: "yes" },
    { email: null, name: "Aunt Jo", status: "maybe" },
  ];
  const values = formValuesFromEvent(makeEvent({ attendees }));

  assert.deepEqual(values.memberStatuses, { "a@example.com": "yes" });
  // No padding: the form adds guest rows on demand instead.
  assert.deepEqual(values.guests, [{ name: "Aunt Jo", status: "maybe" }]);
  assert.equal(values.startDate, "2026-11-26");
  assert.equal(values.startTime, "14:00");
  assert.equal(values.categoryId, "holiday");
});

test("guest rows parse with gaps, and a blank name drops the guest", () => {
  // Clearing the name is how a guest is removed.
  assert.deepEqual(formValuesFromBody({ "guestName:0": "   " }, "evt-1", []).guests, []);

  // Removing a row in the browser leaves a hole in the indexes.
  const sparse = formValuesFromBody(
    { "guestName:0": "Aunt Jo", "guestName:3": "Cousin Pat", "guestStatus:3": "yes" },
    null,
    [],
  );
  assert.deepEqual(sparse.guests, [
    { name: "Aunt Jo", status: "invited" },
    { name: "Cousin Pat", status: "yes" },
  ]);
});

test("groupAttendees orders answers yes, maybe, no, then unanswered", () => {
  const groups = groupAttendees([
    { email: "a@example.com", name: null, status: "invited" },
    { email: "b@example.com", name: null, status: "no" },
    { email: null, name: "Aunt Jo", status: "yes" },
    { email: "c@example.com", name: null, status: "maybe" },
  ]);

  assert.deepEqual(
    groups.map((g) => g.status),
    ["yes", "maybe", "no", "invited"],
  );
  assert.deepEqual(groups[0]!.people.map((p) => p.name), ["Aunt Jo"]);
  // Statuses nobody holds don't get an empty heading.
  assert.deepEqual(groupAttendees([]), []);
});

test("attendeeSummary labels every person for the grid tooltip", () => {
  const summary = attendeeSummary([
    { email: "a@example.com", name: null, status: "yes" },
    { email: null, name: "Aunt Jo", status: "invited" },
  ]);
  assert.equal(summary, "a@example.com — Yes\nAunt Jo — Invited");
  assert.equal(attendeeSummary([]), "");
});

test("formatEventWhen says All day without times, and spans dates", () => {
  const oneDay = formatEventWhen({
    startAt: new Date(2026, 10, 26, 0, 0),
    endAt: new Date(2026, 10, 26, 23, 59, 59, 999),
    allDay: true,
  });
  assert.match(oneDay, /All day/);
  assert.doesNotMatch(oneDay, /–/);

  const span = formatEventWhen({
    startAt: new Date(2026, 10, 26, 0, 0),
    endAt: new Date(2026, 10, 29, 23, 59, 59, 999),
    allDay: true,
  });
  assert.match(span, /All day/);
  assert.match(span, /–/);

  const timed = formatEventWhen({
    startAt: new Date(2026, 10, 26, 14, 0),
    endAt: new Date(2026, 10, 26, 18, 0),
    allDay: false,
  });
  assert.doesNotMatch(timed, /All day/);
  assert.match(timed, /–/);
});

test("a blank form opens on a given day with workable default times", () => {
  const onADay = blankFormValues(["a@example.com"], "2026-11-26");
  assert.equal(onADay.startDate, "2026-11-26");
  assert.equal(onADay.endDate, "2026-11-26");
  assert.equal(onADay.startTime, "09:00");
  assert.equal(onADay.endTime, "10:00");
  assert.equal(onADay.allDay, false);
  assert.equal(onADay.title, "");
  assert.deepEqual(onADay.memberStatuses, {});
  assert.deepEqual(onADay.guests, []);

  // No date, or a junk one, just leaves the date fields empty.
  assert.equal(blankFormValues([]).startDate, "");
  assert.equal(blankFormValues([], "26 Nov 2026").startDate, "");
});
