import assert from "node:assert/strict";
import test from "node:test";
import { canView, visibleTo } from "../src/lib/subscription-access.js";
import type { SubscriptionDoc } from "../src/lib/types.js";

function makeSubscription(overrides: Partial<SubscriptionDoc> = {}): SubscriptionDoc {
  return {
    id: "sub1",
    name: "Netflix",
    accountEmail: "family@example.com",
    accountPhone: null,
    link: null,
    notes: null,
    hasPassword: false,
    memberEmails: ["dad@example.com"],
    createdBy: "admin@example.com",
    createdAt: new Date(2026, 9, 1),
    updatedAt: new Date(2026, 9, 1),
    ...overrides,
  };
}

test("canView lets a member on the access list in", () => {
  assert.equal(canView({ email: "dad@example.com", role: "member" }, makeSubscription()), true);
});

test("canView keeps a member off the access list out", () => {
  assert.equal(canView({ email: "sib@example.com", role: "member" }, makeSubscription()), false);
});

test("canView lets an admin see a subscription they're not on", () => {
  assert.equal(canView({ email: "admin@example.com", role: "admin" }, makeSubscription()), true);
});

test("canView matches a viewer's email regardless of casing or stray whitespace", () => {
  const viewer = { email: "  Dad@Example.COM  ", role: "member" as const };
  assert.equal(canView(viewer, makeSubscription()), true);
});

test("canView keeps a member out of a subscription with an empty access list", () => {
  assert.equal(
    canView({ email: "dad@example.com", role: "member" }, makeSubscription({ memberEmails: [] })),
    false,
  );
});

test("visibleTo returns only the subscriptions a member is on", () => {
  const subscriptions = [
    makeSubscription({ id: "a", name: "Netflix", memberEmails: ["dad@example.com"] }),
    makeSubscription({ id: "b", name: "Spotify", memberEmails: ["sib@example.com"] }),
    makeSubscription({ id: "c", name: "iCloud", memberEmails: ["dad@example.com", "mum@example.com"] }),
  ];
  const visible = visibleTo({ email: "dad@example.com", role: "member" }, subscriptions);
  assert.deepEqual(
    visible.map((subscription) => subscription.id),
    ["a", "c"],
  );
});

test("visibleTo returns everything for an admin", () => {
  const subscriptions = [
    makeSubscription({ id: "a", memberEmails: [] }),
    makeSubscription({ id: "b", memberEmails: ["sib@example.com"] }),
  ];
  const visible = visibleTo({ email: "admin@example.com", role: "admin" }, subscriptions);
  assert.equal(visible.length, 2);
});
