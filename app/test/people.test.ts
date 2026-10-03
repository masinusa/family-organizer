import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidHexColor } from "../src/lib/categories.js";
import { detailsSummary } from "../src/lib/event-fields.js";
import {
  avatarColor,
  avatarFor,
  avatarForEmail,
  displayName,
  initialOf,
} from "../src/lib/people.js";
import type { FormValues } from "../src/lib/event-input.js";

test("displayName turns an address into something recognisable", () => {
  assert.equal(displayName("mary.jane@example.com"), "Mary Jane");
  assert.equal(displayName("mary_jane-smith@example.com"), "Mary Jane Smith");
  // A +tag is routing, not part of anyone's name.
  assert.equal(displayName("mary.jane+family@example.com"), "Mary Jane");
  assert.equal(displayName("masinusa@gmail.com"), "Masinusa");
  // Nothing usable left: better the whole address than an empty chip.
  assert.equal(displayName("...@example.com"), "...@example.com");
});

test("initialOf picks the first letter or number, whatever the script", () => {
  assert.equal(initialOf("Aunt Jo"), "A");
  assert.equal(initialOf("  ernie"), "E");
  assert.equal(initialOf("80th party"), "8");
  assert.equal(initialOf("Ängela"), "Ä");
  assert.equal(initialOf("!!!"), "?");
  assert.equal(initialOf(""), "?");
});

test("avatar colours are stable, case-insensitive and always valid", () => {
  assert.equal(avatarColor("a@example.com"), avatarColor("A@Example.com "));
  const colors = new Set<string>();
  for (const key of ["a@x.com", "b@x.com", "c@x.com", "Aunt Jo", "Cousin Pat"]) {
    const color = avatarColor(key);
    assert.equal(isValidHexColor(color), true, `${key} -> ${color}`);
    colors.add(color);
  }
  // Not a hard guarantee of uniqueness, but a hash that bunched everything
  // onto one colour would make a roster unreadable.
  assert.ok(colors.size > 1);
});

test("an avatar labels a member by name and a guest by theirs", () => {
  const member = avatarForEmail("mary.jane@example.com");
  assert.equal(member.label, "Mary Jane");
  assert.equal(member.initial, "M");
  assert.equal(member.sub, "mary.jane@example.com");

  const guest = avatarFor({ email: null, name: "Aunt Jo", status: "invited" });
  assert.equal(guest.label, "Aunt Jo");
  assert.equal(guest.sub, null);

  // Text sitting on the avatar is always one of the two readable inks.
  assert.ok(["#ffffff", "#26291f"].includes(member.ink));
});

function values(overrides: Partial<FormValues>): FormValues {
  return {
    id: null,
    title: "",
    description: "",
    allDay: false,
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
    location: "",
    link: "",
    categoryId: "",
    memberStatuses: {},
    guests: [],
    ...overrides,
  };
}

test("the collapsed Details row says whether it's worth opening", () => {
  assert.equal(detailsSummary(values({})), "Add a place, link or notes");
  assert.equal(detailsSummary(values({ location: "Nana's house" })), "Nana's house");
  assert.equal(
    detailsSummary(values({ location: "Nana's", link: "https://x.com", description: "Pie" })),
    "Nana's · link · notes",
  );
  assert.equal(detailsSummary(values({ link: "https://x.com" })), "link");

  // A long place name is trimmed rather than stretching the row.
  const long = detailsSummary(values({ location: "The big house at the end of the lane" }));
  assert.ok(long.endsWith("…"), long);
  assert.ok(long.length <= 28, long);
});
