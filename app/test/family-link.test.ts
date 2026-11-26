import assert from "node:assert/strict";
import { test } from "node:test";
import { canEditPersona, findDuplicateEmailOwner } from "../src/lib/family-link.js";
import type { PersonDoc } from "../src/lib/types.js";

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

test("an admin may edit anyone, including people with no email", () => {
  const admin = { email: "admin@example.com", role: "admin" as const };
  assert.equal(canEditPersona(admin, makePerson({ email: null })), true);
  assert.equal(canEditPersona(admin, makePerson({ email: "other@example.com" })), true);
});

test("a member may edit only their own card", () => {
  const member = { email: "ada@example.com", role: "member" as const };
  assert.equal(canEditPersona(member, makePerson({ email: "ada@example.com" })), true);
  assert.equal(canEditPersona(member, makePerson({ email: "Ada@Example.com " })), true);
  assert.equal(canEditPersona(member, makePerson({ email: "bob@example.com" })), false);
  assert.equal(canEditPersona(member, makePerson({ email: null })), false);
});

test("a duplicate email is detected, excluding the person being edited", () => {
  const people = [
    makePerson({ id: "p1", name: "Ada", email: "ada@example.com" }),
    makePerson({ id: "p2", name: "Bob", email: "bob@example.com" }),
  ];
  // Re-saving your own email isn't a clash.
  assert.equal(findDuplicateEmailOwner(people, "ada@example.com", "p1"), null);
  assert.equal(findDuplicateEmailOwner(people, "ADA@example.com", "p2")?.name, "Ada");
  assert.equal(findDuplicateEmailOwner(people, "new@example.com", "p2"), null);
});
