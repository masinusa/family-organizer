import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTreeLayout,
  compactGenerations,
  computeGenerations,
  CARD_HEIGHT,
  CARD_WIDTH,
  COL_GAP,
  ROW_GAP,
} from "../src/lib/tree-layout.js";
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

function findCard(layout: ReturnType<typeof buildTreeLayout>, id: string) {
  const card = layout.cards.find((c) => c.person.id === id);
  assert.ok(card, `expected a card for ${id}`);
  return card!;
}

test("empty tree has no cards or connectors", () => {
  const layout = buildTreeLayout([]);
  assert.deepEqual(layout, { cards: [], connectors: [], width: 0, height: 0 });
});

test("a lone person with no relationships sits at generation 0", () => {
  const layout = buildTreeLayout([makePerson({ id: "solo", name: "Solo" })]);
  assert.equal(layout.cards.length, 1);
  assert.equal(layout.cards[0]!.generation, 0);
  assert.equal(layout.connectors.length, 0);
});

test("simple 3-generation nuclear family stacks generations and connects partners/children", () => {
  const people = [
    makePerson({ id: "gp1", name: "Grandparent 1", partnerIds: ["gp2"] }),
    makePerson({ id: "gp2", name: "Grandparent 2", partnerIds: ["gp1"] }),
    makePerson({ id: "parent1", name: "Parent 1", parentIds: ["gp1", "gp2"], partnerIds: ["parent2"] }),
    makePerson({ id: "parent2", name: "Parent 2", partnerIds: ["parent1"] }),
    makePerson({ id: "child1", name: "Child 1", parentIds: ["parent1", "parent2"] }),
  ];

  const layout = buildTreeLayout(people);

  assert.equal(findCard(layout, "gp1").generation, 0);
  assert.equal(findCard(layout, "gp2").generation, 0);
  assert.equal(findCard(layout, "parent1").generation, 1);
  assert.equal(findCard(layout, "parent2").generation, 1);
  assert.equal(findCard(layout, "child1").generation, 2);

  // Partner pairs sit on the same row.
  assert.equal(findCard(layout, "gp1").y, findCard(layout, "gp2").y);
  assert.equal(findCard(layout, "parent1").y, findCard(layout, "parent2").y);

  // Every generation is a distinct, increasing row.
  const rows = new Set(layout.cards.map((c) => c.y));
  assert.equal(rows.size, 3);
});

test("a person with two partners produces distinct sibling clusters per partner", () => {
  const people = [
    makePerson({ id: "a", name: "A", partnerIds: ["b", "d"] }),
    makePerson({ id: "b", name: "B", partnerIds: ["a"] }),
    makePerson({ id: "d", name: "D", partnerIds: ["a"] }),
    makePerson({ id: "c1", name: "C1", parentIds: ["a", "b"] }),
    makePerson({ id: "c2", name: "C2", parentIds: ["a", "b"] }),
    makePerson({ id: "e1", name: "E1", parentIds: ["a", "d"] }),
    makePerson({ id: "e2", name: "E2", parentIds: ["a", "d"] }),
  ];

  const layout = buildTreeLayout(people);

  const abGroupCols = [findCard(layout, "c1").column, findCard(layout, "c2").column].sort((x, y) => x - y);
  const adGroupCols = [findCard(layout, "e1").column, findCard(layout, "e2").column].sort((x, y) => x - y);

  // Each group is contiguous...
  assert.equal(abGroupCols[1]! - abGroupCols[0]!, 1);
  assert.equal(adGroupCols[1]! - adGroupCols[0]!, 1);
  // ...and the two groups don't interleave with each other.
  const overlaps =
    abGroupCols[0]! <= adGroupCols[1]! && adGroupCols[0]! <= abGroupCols[1]!;
  assert.equal(overlaps, false);

  // Two separate parent->children bundles means two separate buses (5 lines
  // per bundle: 2 parent stubs + 1 bus + 2 child stubs).
  assert.equal(layout.connectors.length, 1 /* a-b partner line */ + 1 /* a-d partner line */ + 5 + 5);
});

test("a child's generation reconciles unequal parent generations via max()", () => {
  const people = [
    makePerson({ id: "gp", name: "Grandparent" }),
    makePerson({ id: "deepParent", name: "Deep parent", parentIds: ["gp"] }), // gen 1
    makePerson({ id: "shallowParent", name: "Shallow parent" }), // gen 0, unpartnered
    makePerson({ id: "child", name: "Child", parentIds: ["deepParent", "shallowParent"] }),
  ];

  const gen = computeGenerations(people);
  assert.equal(gen.get("gp"), 0);
  assert.equal(gen.get("deepParent"), 1);
  assert.equal(gen.get("shallowParent"), 0);
  // max(1, 0) + 1 = 2, not 1.
  assert.equal(gen.get("child"), 2);
});

test("compactGenerations remaps sparse generation values to consecutive integers", () => {
  const gen = new Map([
    ["a", 0],
    ["b", 0],
    ["c", 5],
  ]);
  const compacted = compactGenerations(gen);
  assert.equal(compacted.get("a"), 0);
  assert.equal(compacted.get("b"), 0);
  assert.equal(compacted.get("c"), 1);
});

test("card pixel sizing matches the exported constants", () => {
  const people = [
    makePerson({ id: "parent", name: "Parent" }),
    makePerson({ id: "child", name: "Child", parentIds: ["parent"] }),
  ];
  const layout = buildTreeLayout(people);
  const parent = findCard(layout, "parent");
  const child = findCard(layout, "child");

  assert.equal(parent.y, 0);
  assert.equal(child.y, CARD_HEIGHT + ROW_GAP);
  // Columns are a monotonic global counter, so even an only child (no
  // siblings, no partners) consumes a fresh column rather than staying
  // under its parent — a known heuristic tradeoff (see tree-layout.ts).
  assert.equal(child.column, parent.column + 1);
  assert.equal(layout.width, (child.column + 1) * (CARD_WIDTH + COL_GAP) - COL_GAP);
});
