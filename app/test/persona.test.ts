import assert from "node:assert/strict";
import { test } from "node:test";
import {
  colorFor,
  daysInMonth,
  formatBirthday,
  initialsFor,
  isValidBirthYear,
  guestPersona,
  MIN_BIRTH_YEAR,
  CIRCLE_MISMATCH_ERROR,
  ORPHAN_ACCOUNT_ERROR,
  PERSONA_COLORS,
  PersonaDirectory,
  UNKNOWN_COLOR,
} from "../src/lib/persona.js";
import type { PersonDoc, UserDoc } from "../src/lib/types.js";

test("initials take the first and last name parts", () => {
  assert.equal(initialsFor("Willa Spicer"), "WS");
});

test("a single name yields a single initial", () => {
  assert.equal(initialsFor("Willa"), "W");
});

test("middle names are skipped in favour of the surname", () => {
  assert.equal(initialsFor("Mary Anne Louise Spicer"), "MS");
});

test("hyphenated and extra-spaced names still resolve", () => {
  assert.equal(initialsFor("Mary-Jane  Smith"), "MS");
  assert.equal(initialsFor("  Ada   Lovelace  "), "AL");
});

test("an empty name falls back rather than throwing", () => {
  assert.equal(initialsFor(""), "?");
  assert.equal(initialsFor("   "), "?");
});

test("initials are uppercased and handle non-ASCII first letters", () => {
  assert.equal(initialsFor("ada lovelace"), "AL");
  assert.equal(initialsFor("Édith Piaf"), "ÉP");
});

test("an explicitly chosen color wins", () => {
  const color = colorFor({ name: "Whoever", color: "lilac" });
  assert.equal(color.key, "lilac");
});

test("an unknown color key falls back to a derived one", () => {
  const color = colorFor({ name: "Whoever", color: "chartreuse" });
  assert.ok(PERSONA_COLORS.includes(color));
});

test("a derived color is stable for the same name", () => {
  const first = colorFor({ name: "Andrew Spicer", color: null });
  const second = colorFor({ name: "Andrew Spicer", color: null });
  assert.equal(first.key, second.key);
});

test("birthdays format without a year, and only when complete", () => {
  assert.equal(formatBirthday(3, 4), "Mar 4");
  assert.equal(formatBirthday(12, 25), "Dec 25");
  assert.equal(formatBirthday(null, 4), null);
  assert.equal(formatBirthday(3, null), null);
  assert.equal(formatBirthday(13, 4), null);
});

test("February offers 29 days so a leap-year birthday is selectable", () => {
  assert.equal(daysInMonth(2), 29);
  assert.equal(daysInMonth(1), 31);
  assert.equal(daysInMonth(4), 30);
});

test("the birthday never includes the year, which is tracked separately", () => {
  // Guards the deliberate split: formatBirthday takes no year argument,
  // so a year can never leak into the day label.
  assert.equal(formatBirthday(3, 4), "Mar 4");
  assert.equal(formatBirthday.length, 2);
});

test("a birth year is accepted across the plausible range", () => {
  const now = new Date(2026, 0, 1);
  assert.equal(isValidBirthYear(1952, now), true);
  assert.equal(isValidBirthYear(MIN_BIRTH_YEAR, now), true);
  assert.equal(isValidBirthYear(2026, now), true, "the current year is valid");
});

test("an implausible or malformed birth year is rejected", () => {
  const now = new Date(2026, 0, 1);
  assert.equal(isValidBirthYear(2027, now), false, "the future is not a birth year");
  assert.equal(isValidBirthYear(MIN_BIRTH_YEAR - 1, now), false);
  assert.equal(isValidBirthYear(19, now), false, "a mistyped two-digit year");
  assert.equal(isValidBirthYear(1952.5, now), false);
  assert.equal(isValidBirthYear(Number.NaN, now), false);
});

/* ---------------------------- directory ---------------------------- */

function makePerson(overrides: Partial<PersonDoc> = {}): PersonDoc {
  return {
    id: "person",
    name: "Person",
    circle: "family",
    email: null,
    blurb: null,
    birthMonth: null,
    birthDay: null,
    birthYear: null,
    color: null,
    parentIds: [],
    connectionIds: [],
    createdAt: new Date(2026, 9, 1),
    updatedAt: new Date(2026, 9, 1),
    ...overrides,
  };
}

function makeUser(overrides: Partial<UserDoc> = {}): UserDoc {
  return {
    email: "someone@example.com",
    role: "member",
    optIns: [],
    createdAt: new Date(2026, 9, 1),
    updatedAt: new Date(2026, 9, 1),
    ...overrides,
  };
}

test("a person is joined to the account sharing their email", () => {
  const directory = new PersonaDirectory(
    [makePerson({ id: "p1", name: "Ada Spicer", email: "ada@example.com", color: "sky" })],
    [makeUser({ email: "ada@example.com", role: "admin" })],
  );
  const ada = directory.byId("p1")!;
  assert.equal(ada.kind, "person");
  assert.equal(ada.role, "admin");
  assert.equal(ada.initials, "AS");
  assert.equal(ada.color.key, "sky", "the chosen colour is used everywhere, not just on the tree");
  assert.equal(ada.subtitle, "ada@example.com · admin");
  assert.equal(directory.byEmail("ada@example.com"), ada);
});

test("the join ignores casing and surrounding whitespace", () => {
  // users doc ids are normalized but PersonDoc.email historically wasn't,
  // so the join has to normalize both sides or silently miss.
  const directory = new PersonaDirectory(
    [makePerson({ id: "p1", email: "  Ada@Example.COM " })],
    [makeUser({ email: "ada@example.com" })],
  );
  assert.equal(directory.byId("p1")!.role, "member");
  assert.equal(directory.byEmail("ADA@example.com ")?.personId, "p1");
});

test("an account with nobody on the tree is refused", () => {
  assert.throws(
    () => new PersonaDirectory([], [makeUser({ email: "ghost@example.com" })]),
    (err: Error) => err.message === `ghost@example.com ${ORPHAN_ACCOUNT_ERROR}`,
  );
});

test("active() is everyone who can sign in, by name", () => {
  const directory = new PersonaDirectory(
    [
      makePerson({ id: "p1", name: "Zed", email: "zed@example.com" }),
      makePerson({ id: "p2", name: "Nana", email: null }),
      makePerson({ id: "p3", name: "Ada", email: "ada@example.com" }),
      makePerson({ id: "p4", name: "Bob", email: "bob@example.com" }),
    ],
    [makeUser({ email: "zed@example.com" }), makeUser({ email: "ada@example.com" })],
  );
  assert.deepEqual(directory.all().map((p) => p.name), ["Ada", "Bob", "Nana", "Zed"]);
  assert.deepEqual(directory.active().map((p) => p.name), ["Ada", "Zed"]);
  assert.equal(directory.byId("p4")!.subtitle, "Not signed in");
});

test("an email nobody has any more resolves to an explicit unknown persona", () => {
  const directory = new PersonaDirectory([], []);
  const unknown = directory.forEmail("Gone@Example.com");
  assert.equal(unknown.kind, "unknown");
  assert.equal(unknown.name, "gone@example.com", "shown as the address, never a guessed name");
  assert.equal(unknown.color, UNKNOWN_COLOR);
});

test("attendees resolve to members or guests", () => {
  const directory = new PersonaDirectory(
    [makePerson({ id: "p1", name: "Ada Spicer", email: "ada@example.com" })],
    [makeUser({ email: "ada@example.com" })],
  );
  assert.equal(directory.forAttendee({ email: "ada@example.com", name: null, status: "yes" }).personId, "p1");
  const guest = directory.forAttendee({ email: null, name: "Aunt Jo", status: "invited" });
  assert.equal(guest.kind, "guest");
  assert.equal(guest.initials, "AJ");
  assert.ok(PERSONA_COLORS.includes(guest.color), "guests share the persona palette");
  assert.equal(guestPersona("Aunt Jo").color.key, guest.color.key, "and keep their colour");
});

/* ----------------------------- friends ----------------------------- */

function friendsAndFamily() {
  return new PersonaDirectory(
    [
      makePerson({ id: "p1", name: "Ada", email: "ada@example.com" }),
      makePerson({ id: "f1", name: "Rae", email: "rae@example.com", circle: "friend" }),
      makePerson({ id: "f2", name: "Kit", email: "kit@example.com", circle: "friend" }),
      makePerson({ id: "f3", name: "Lou", email: null, circle: "friend" }),
    ],
    [
      makeUser({ email: "ada@example.com" }),
      makeUser({ email: "rae@example.com", role: "friend", optIns: ["calendar"] }),
      makeUser({ email: "kit@example.com", role: "friend" }),
    ],
  );
}

test("friends are kept out of the tree and the family rosters", () => {
  const directory = friendsAndFamily();
  assert.deepEqual(directory.all().map((p) => p.name), ["Ada"]);
  assert.deepEqual(directory.active().map((p) => p.name), ["Ada"]);
  assert.deepEqual(directory.family.map((p) => p.id), ["p1"]);
  assert.deepEqual(directory.friends().map((p) => p.name), ["Kit", "Lou", "Rae"]);
});

test("friends still resolve by id and email, so they can be drawn anywhere", () => {
  const directory = friendsAndFamily();
  assert.equal(directory.byId("f1")!.circle, "friend");
  assert.equal(directory.forEmail("rae@example.com").personId, "f1");
  assert.equal(directory.byId("f3")!.subtitle, "Friend · not signed in");
});

test("a feature's audience is family accounts plus the friends opted into it", () => {
  const directory = friendsAndFamily();
  assert.deepEqual(directory.audience("calendar").map((p) => p.name), ["Ada", "Rae"]);
  assert.deepEqual(directory.audience("vault").map((p) => p.name), ["Ada"]);
  assert.deepEqual(directory.withAccounts().map((p) => p.name), ["Ada", "Kit", "Rae"]);
  assert.deepEqual(directory.optInsOf(directory.byId("f1")!), ["calendar"]);
});

test("a friend account on somebody on the tree is refused", () => {
  assert.throws(
    () =>
      new PersonaDirectory(
        [makePerson({ id: "p1", email: "ada@example.com" })],
        [makeUser({ email: "ada@example.com", role: "friend" })],
      ),
    (err: Error) => err.message === `ada@example.com ${CIRCLE_MISMATCH_ERROR}`,
  );
});

test("a family account on a friend is refused", () => {
  assert.throws(
    () =>
      new PersonaDirectory(
        [makePerson({ id: "f1", email: "rae@example.com", circle: "friend" })],
        [makeUser({ email: "rae@example.com", role: "admin" })],
      ),
    (err: Error) => err.message === `rae@example.com ${CIRCLE_MISMATCH_ERROR}`,
  );
});
