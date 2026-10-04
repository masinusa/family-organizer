import assert from "node:assert/strict";
import { test } from "node:test";
import {
  colorFor,
  daysInMonth,
  formatBirthday,
  initialsFor,
  isValidBirthYear,
  MIN_BIRTH_YEAR,
  PERSONA_COLORS,
} from "../src/lib/persona.js";

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
