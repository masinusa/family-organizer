import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assignmentError,
  brokenRules,
  drawAssignments,
  drawExclusions,
  formatExchangeDate,
  isCalendarDate,
  NO_VALID_DRAW_ERROR,
  pairKey,
  parseAssignments,
  parseDetails,
  prunedAssignments,
  TOO_FEW_ERROR,
  unassignedIds,
} from "../src/lib/secret-santa.js";
import type { PersonDoc, SecretSantaDoc } from "../src/lib/types.js";

/** Deterministic, so a failing seed can be replayed. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function person(id: string, connectionIds: string[] = []): PersonDoc {
  const at = new Date(2026, 9, 1);
  return {
    id, name: id, circle: "family", email: null, blurb: null, birthMonth: null, birthDay: null,
    birthYear: null, color: null, parentIds: [], connectionIds, createdAt: at, updatedAt: at,
  };
}

function exchange(overrides: Partial<SecretSantaDoc> = {}): SecretSantaDoc {
  const at = new Date(2026, 9, 1);
  return {
    year: 2026, budget: null, exchangeDate: null, participantIds: [], assignments: {},
    drawnAt: null, createdBy: "admin@example.com", createdAt: at, updatedAt: at, ...overrides,
  };
}

const ids = ["a", "b", "c", "d", "e", "f"];

test("every draw is a whole draw: everyone gives once, receives once, never themselves", () => {
  for (let seed = 1; seed <= 500; seed++) {
    const result = drawAssignments(ids, new Set(), seeded(seed));
    assert.equal(assignmentError(ids, result), null, `seed ${seed}`);
  }
});

test("the draw respects every forbidden pair", () => {
  const forbidden = new Set([pairKey("a", "b"), pairKey("b", "a"), pairKey("c", "d"), pairKey("d", "c")]);
  for (let seed = 1; seed <= 500; seed++) {
    const result = drawAssignments(ids, forbidden, seeded(seed));
    assert.deepEqual(brokenRules(result, forbidden), [], `seed ${seed}`);
  }
});

test("the draw isn't stuck on one answer", () => {
  const outcomes = new Set<string>();
  for (let seed = 1; seed <= 100; seed++) outcomes.add(JSON.stringify(drawAssignments(ids, new Set(), seeded(seed))));
  assert.ok(outcomes.size > 20, `only ${outcomes.size} distinct draws`);
});

test("two people can only draw each other", () => {
  assert.deepEqual(drawAssignments(["a", "b"], new Set(), seeded(1)), { a: "b", b: "a" });
});

test("rules nobody can meet throw instead of breaking one quietly", () => {
  assert.throws(() => drawAssignments(["a", "b"], new Set([pairKey("a", "b")]), seeded(1)), { message: NO_VALID_DRAW_ERROR });
  // Everyone forbidden from everyone: gives up within the step budget.
  const many = Array.from({ length: 12 }, (_, i) => `p${i}`);
  const all = new Set(many.flatMap((g) => many.map((r) => pairKey(g, r))));
  assert.throws(() => drawAssignments(many, all, seeded(1)), { message: NO_VALID_DRAW_ERROR });
});

test("fewer than two people can't be drawn", () => {
  assert.throws(() => drawAssignments(["a"], new Set()), { message: TOO_FEW_ERROR });
  assert.throws(() => drawAssignments([], new Set()), { message: TOO_FEW_ERROR });
});

test("exclusions cover partners both ways and last year's pairs as drawn", () => {
  const people = [person("a", ["b"]), person("b", ["a"]), person("c", ["z"]), person("d")];
  const forbidden = drawExclusions(["a", "b", "c", "d"], people, { c: "d", a: "z" });
  assert.deepEqual([...forbidden].sort(), ["a>b", "b>a", "c>d"]);
});

test("a hand edit must still be a whole draw", () => {
  const four = ["a", "b", "c", "d"];
  assert.equal(assignmentError(four, { a: "b", b: "c", c: "d", d: "a" }), null);
  assert.match(assignmentError(four, { a: "b", b: "c", c: "d" })!, /Everyone needs/);
  assert.match(assignmentError(four, { a: "a", b: "c", c: "d", d: "b" })!, /themselves/);
  assert.match(assignmentError(four, { a: "b", b: "c", c: "b", d: "a" })!, /same person/);
  assert.match(assignmentError(four, { a: "b", b: "c", c: "d", d: "x" })!, /in the exchange/);
});

test("the table only reads participants' rows", () => {
  const parsed = parseAssignments({ "to:a": "b", "to:b": "a", "to:x": "a", "to:c": "" }, ["a", "b", "c"]);
  assert.deepEqual(parsed, { a: "b", b: "a" });
});

test("changing who's in keeps every pair that still makes sense", () => {
  assert.deepEqual(prunedAssignments(["a", "b", "d"], { a: "b", b: "c", c: "d", d: "a" }), { a: "b", d: "a" });
});

test("after someone leaves, their Santa and their recipient are flagged", () => {
  const e = exchange({ participantIds: ["a", "b", "d"], assignments: { a: "b", d: "a" } });
  assert.deepEqual(unassignedIds(e), ["b", "d"]);
  assert.deepEqual(unassignedIds(exchange({ participantIds: ["a", "b"], assignments: { a: "b", b: "a" } })), []);
});

test("budget and date parse, and reject what isn't one", () => {
  assert.deepEqual(parseDetails({ budget: "50", exchangeDate: "2026-12-24" }), { budget: 50, exchangeDate: "2026-12-24" });
  assert.deepEqual(parseDetails({ budget: "$25", exchangeDate: "" }), { budget: 25, exchangeDate: null });
  assert.deepEqual(parseDetails({}), { budget: null, exchangeDate: null });
  assert.ok("error" in parseDetails({ budget: "12.50" }));
  assert.ok("error" in parseDetails({ budget: "0" }));
  assert.ok("error" in parseDetails({ budget: "100000" }));
  assert.ok("error" in parseDetails({ exchangeDate: "2026-02-30" }));
  assert.ok("error" in parseDetails({ exchangeDate: "Dec 24" }));
});

test("a calendar date is exactly YYYY-MM-DD and a real day", () => {
  assert.equal(isCalendarDate("2028-02-29"), true);
  assert.equal(isCalendarDate("2026-02-29"), false);
  assert.equal(isCalendarDate("2026-12-24T00:00"), false);
});

test("an exchange date is shown as the day it names, in any timezone", () => {
  assert.equal(formatExchangeDate("2026-12-24"), "Thu, Dec 24");
});
