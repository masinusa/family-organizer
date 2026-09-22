import assert from "node:assert/strict";
import { test } from "node:test";
import { isLastAdmin } from "../src/lib/users-repo.js";
import type { UserDoc } from "../src/lib/types.js";

function makeUser(overrides: Partial<UserDoc> = {}): UserDoc {
  return {
    email: "someone@example.com",
    role: "member",
    createdAt: new Date(2026, 8, 1),
    updatedAt: new Date(2026, 8, 1),
    ...overrides,
  };
}

test("is the last admin when they're the only admin", () => {
  const users = [makeUser({ email: "admin@example.com", role: "admin" })];
  assert.equal(isLastAdmin(users, "admin@example.com"), true);
});

test("is not the last admin when the target is someone else", () => {
  const users = [makeUser({ email: "admin@example.com", role: "admin" })];
  assert.equal(isLastAdmin(users, "other@example.com"), false);
});

test("is not the last admin when multiple admins exist", () => {
  const users = [
    makeUser({ email: "admin@example.com", role: "admin" }),
    makeUser({ email: "second-admin@example.com", role: "admin" }),
  ];
  assert.equal(isLastAdmin(users, "admin@example.com"), false);
});

test("is not the last admin when the target is only a member", () => {
  const users = [
    makeUser({ email: "admin@example.com", role: "admin" }),
    makeUser({ email: "member@example.com", role: "member" }),
  ];
  assert.equal(isLastAdmin(users, "member@example.com"), false);
});
