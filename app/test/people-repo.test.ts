import assert from "node:assert/strict";
import { test } from "node:test";
import { findDescendantIds } from "../src/lib/people-repo.js";
import type { PersonDoc } from "../src/lib/types.js";

function makePerson(overrides: Partial<PersonDoc> = {}): PersonDoc {
  return {
    id: "person",
    name: "Person",
    email: null,
    parentIds: [],
    partnerIds: [],
    createdAt: new Date(2026, 8, 1),
    updatedAt: new Date(2026, 8, 1),
    ...overrides,
  };
}

test("finds no descendants for someone with no children", () => {
  const people = [makePerson({ id: "a" })];
  assert.deepEqual(findDescendantIds("a", people), new Set());
});

test("finds direct children", () => {
  const people = [makePerson({ id: "a" }), makePerson({ id: "b", parentIds: ["a"] })];
  assert.deepEqual(findDescendantIds("a", people), new Set(["b"]));
});

test("finds grandchildren transitively", () => {
  const people = [
    makePerson({ id: "a" }),
    makePerson({ id: "b", parentIds: ["a"] }),
    makePerson({ id: "c", parentIds: ["b"] }),
  ];
  assert.deepEqual(findDescendantIds("a", people), new Set(["b", "c"]));
});

test("does not include ancestors, siblings, or unrelated people", () => {
  const people = [
    makePerson({ id: "gp" }),
    makePerson({ id: "a", parentIds: ["gp"] }),
    makePerson({ id: "sibling", parentIds: ["gp"] }),
    makePerson({ id: "b", parentIds: ["a"] }),
    makePerson({ id: "unrelated" }),
  ];
  assert.deepEqual(findDescendantIds("a", people), new Set(["b"]));
});

test("handles a child with two parents without double-counting or looping", () => {
  const people = [
    makePerson({ id: "a" }),
    makePerson({ id: "b" }),
    makePerson({ id: "c", parentIds: ["a", "b"] }),
    makePerson({ id: "d", parentIds: ["c"] }),
  ];
  assert.deepEqual(findDescendantIds("a", people), new Set(["c", "d"]));
  assert.deepEqual(findDescendantIds("b", people), new Set(["c", "d"]));
});
