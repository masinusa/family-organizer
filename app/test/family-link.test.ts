import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canEditPersona,
  findDuplicateEmailOwner,
  findPersonForEmail,
  matchAccounts,
} from "../src/lib/family-link.js";
import type { PersonDoc, UserDoc } from "../src/lib/types.js";

function makePerson(overrides: Partial<PersonDoc> = {}): PersonDoc {
  return {
    id: "person",
    name: "Person",
    email: null,
    blurb: null,
    birthMonth: null,
    birthDay: null,
    birthYear: null,
    color: null,
    parentIds: [],
    partnerIds: [],
    createdAt: new Date(2026, 9, 1),
    updatedAt: new Date(2026, 9, 1),
    ...overrides,
  };
}

function makeUser(overrides: Partial<UserDoc> = {}): UserDoc {
  return {
    email: "someone@example.com",
    role: "member",
    createdAt: new Date(2026, 9, 1),
    updatedAt: new Date(2026, 9, 1),
    ...overrides,
  };
}

test("a person is matched to the account sharing their email", () => {
  const people = [makePerson({ id: "p1", email: "ada@example.com" })];
  const users = [makeUser({ email: "ada@example.com" })];

  const { accountByPersonId, orphanAccounts } = matchAccounts(people, users);
  assert.equal(accountByPersonId.get("p1")?.email, "ada@example.com");
  assert.deepEqual(orphanAccounts, []);
});

test("matching ignores casing and surrounding whitespace", () => {
  // users doc ids are normalized but PersonDoc.email historically wasn't,
  // so the join has to normalize both sides or silently miss.
  const people = [makePerson({ id: "p1", email: "  Ada@Example.COM " })];
  const users = [makeUser({ email: "ada@example.com" })];

  const { accountByPersonId, orphanAccounts } = matchAccounts(people, users);
  assert.equal(accountByPersonId.get("p1")?.email, "ada@example.com");
  assert.deepEqual(orphanAccounts, []);
});

test("an account with nobody on the tree is reported as an orphan", () => {
  const people = [makePerson({ id: "p1", email: "ada@example.com" })];
  const users = [makeUser({ email: "ada@example.com" }), makeUser({ email: "ghost@example.com" })];

  const { orphanAccounts } = matchAccounts(people, users);
  assert.deepEqual(orphanAccounts.map((u) => u.email), ["ghost@example.com"]);
});

test("people without an email simply have no account", () => {
  const people = [makePerson({ id: "p1", email: null })];
  const { accountByPersonId, orphanAccounts } = matchAccounts(people, []);
  assert.equal(accountByPersonId.size, 0);
  assert.deepEqual(orphanAccounts, []);
});

test("the signed-in viewer resolves to their own person", () => {
  const people = [
    makePerson({ id: "p1", email: "ada@example.com" }),
    makePerson({ id: "p2", email: "bob@example.com" }),
  ];
  assert.equal(findPersonForEmail(people, "BOB@example.com")?.id, "p2");
  assert.equal(findPersonForEmail(people, "nobody@example.com"), null);
});

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
