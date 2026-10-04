import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTreeLayout,
  compactGenerations,
  computeGenerations,
  CARD_EXPANDED_WIDTH,
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
    blurb: null,
    birthMonth: null,
    birthDay: null,
    birthYear: null,
    color: null,
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
  assert.deepEqual(layout.cards, []);
  assert.deepEqual(layout.connectors, []);
  assert.equal(layout.width, 0);
  assert.equal(layout.height, 0);
  // Still reports card sizing so the template can set its CSS vars.
  assert.equal(layout.cardWidth, CARD_WIDTH);
  assert.equal(layout.cardHeight, CARD_HEIGHT);
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

  // Two separate parent->children bundles, each 5 paths: 2 parent drops,
  // 1 bus joining them, and 1 elbow per child.
  assert.equal(layout.connectors.length, 1 /* a-b partner */ + 1 /* a-d partner */ + 5 + 5);
  assert.equal(layout.connectors.filter((c) => c.kind === "partner").length, 2);
});

test("partner links are marked for the heart at their midpoint", () => {
  const people = [
    makePerson({ id: "a", name: "A", partnerIds: ["b"] }),
    makePerson({ id: "b", name: "B", partnerIds: ["a"] }),
  ];
  const layout = buildTreeLayout(people);

  const partners = layout.connectors.filter((c) => c.kind === "partner");
  assert.equal(partners.length, 1, "a reciprocal pair should only draw one line");

  const [a, b] = [findCard(layout, "a"), findCard(layout, "b")];
  const link = partners[0]!;
  // Spans the gap between the two cards, at their shared mid-height.
  assert.equal(link.markX, (a.x + CARD_WIDTH + b.x) / 2);
  assert.equal(link.markY, a.y + CARD_HEIGHT / 2);
});

test("a child offset from its parent gets a rounded elbow, not a hard corner", () => {
  // Two siblings: the parent centres between them, so neither child sits
  // directly below it and both are reached by a curve.
  const people = [
    makePerson({ id: "p", name: "Parent" }),
    makePerson({ id: "a", name: "A", parentIds: ["p"] }),
    makePerson({ id: "b", name: "B", parentIds: ["p"] }),
  ];
  const layout = buildTreeLayout(people);

  const elbows = layout.connectors.filter((c) => c.kind === "parent" && c.d.includes("Q"));
  assert.equal(elbows.length, 2, "each offset child should be reached by a curved path");
  elbows.forEach((e) => assert.ok(e.d.startsWith("M "), "paths are absolute-moveto commands"));
});

test("an only child sits directly under its parent, drawn straight", () => {
  const people = [
    makePerson({ id: "p", name: "Parent" }),
    makePerson({ id: "c", name: "Child", parentIds: ["p"] }),
  ];
  const layout = buildTreeLayout(people);

  // The parent is centred over its one child, so they share an x and
  // there is no corner to round.
  assert.equal(findCard(layout, "p").x, findCard(layout, "c").x);
  assert.deepEqual(layout.connectors.filter((c) => c.d.includes("Q")), []);
});

test("a parent is centred over its two children", () => {
  const people = [
    makePerson({ id: "p", name: "Parent" }),
    makePerson({ id: "a", name: "A", parentIds: ["p"] }),
    makePerson({ id: "b", name: "B", parentIds: ["p"] }),
  ];
  const layout = buildTreeLayout(people);

  const parent = findCard(layout, "p");
  const [a, b] = [findCard(layout, "a"), findCard(layout, "b")];
  assert.equal(parent.x + CARD_WIDTH / 2, (a.x + b.x) / 2 + CARD_WIDTH / 2);
});

test("a couple raising the same children straddles them", () => {
  const people = [
    makePerson({ id: "m", name: "M", partnerIds: ["d"] }),
    makePerson({ id: "d", name: "D", partnerIds: ["m"] }),
    makePerson({ id: "a", name: "A", parentIds: ["m", "d"] }),
    makePerson({ id: "b", name: "B", parentIds: ["m", "d"] }),
  ];
  const layout = buildTreeLayout(people);

  const [m, d] = [findCard(layout, "m"), findCard(layout, "d")];
  const [a, b] = [findCard(layout, "a"), findCard(layout, "b")];
  const coupleCenter = (Math.min(m.x, d.x) + Math.max(m.x, d.x) + CARD_WIDTH) / 2;
  const kidsCenter = (Math.min(a.x, b.x) + Math.max(a.x, b.x) + CARD_WIDTH) / 2;
  assert.equal(coupleCenter, kidsCenter);
  // Partners stay side by side.
  assert.equal(Math.abs(m.x - d.x), CARD_WIDTH + COL_GAP);
});

test("each generation packs from the left instead of using global columns", () => {
  // Two generations deep with a single person per row: without
  // per-generation packing the grandchild would drift two columns right.
  const people = [
    makePerson({ id: "g", name: "G" }),
    makePerson({ id: "p", name: "P", parentIds: ["g"] }),
    makePerson({ id: "c", name: "C", parentIds: ["p"] }),
  ];
  const layout = buildTreeLayout(people);

  assert.deepEqual(layout.cards.map((c) => c.x), [0, 0, 0]);
  assert.equal(layout.width, CARD_WIDTH, "a single lineage should be one card wide");
});

test("siblings never overlap even when both want the same centre", () => {
  // Two childless roots plus one with children all compete for space;
  // the cursor rule must keep them a full stride apart.
  const people = [
    makePerson({ id: "r1", name: "R1" }),
    makePerson({ id: "r2", name: "R2" }),
    makePerson({ id: "r3", name: "R3" }),
    makePerson({ id: "k", name: "K", parentIds: ["r2"] }),
  ];
  const layout = buildTreeLayout(people);

  const row = layout.cards
    .filter((c) => c.generation === 0)
    .sort((a, b) => a.x - b.x);
  for (let i = 1; i < row.length; i++) {
    assert.ok(
      row[i]!.x - row[i - 1]!.x >= CARD_WIDTH + COL_GAP,
      `cards at ${row[i - 1]!.x} and ${row[i]!.x} overlap`,
    );
  }
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

test("a card at the right edge is pinned by that edge so it grows inward", () => {
  // Five siblings: the last one has no room to its right, so expanding it
  // rightward would run off the end of the tree.
  const people = [
    makePerson({ id: "p", name: "Parent" }),
    ...["A", "B", "C", "D", "E"].map((n) =>
      makePerson({ id: n, name: n, parentIds: ["p"] }),
    ),
  ];
  const layout = buildTreeLayout(people);

  const row = layout.cards.filter((c) => c.generation === 1).sort((a, b) => a.x - b.x);
  const last = row[row.length - 1]!;
  const first = row[0]!;

  assert.equal(last.rightInset, 0, "the last card sits flush with the right edge");
  assert.equal(last.anchorRight, true, "so it must grow leftward");
  assert.equal(first.anchorRight, false, "the leftmost card has room to grow rightward");
});

test("a card is never flipped when there is no room to its left", () => {
  // A single card is simultaneously the left and right edge; flipping it
  // would push the expansion off the left side, which can't be scrolled to.
  const layout = buildTreeLayout([makePerson({ id: "solo", name: "Solo" })]);
  const card = layout.cards[0]!;

  assert.equal(card.rightInset, 0);
  assert.equal(card.anchorRight, false, "nowhere to grow left, so stay left-anchored");
  assert.equal(card.x, 0);
});

test("the expanded width is published so CSS and the layout agree", () => {
  const layout = buildTreeLayout([makePerson({ id: "a", name: "A" })]);
  assert.equal(layout.cardExpandedWidth, CARD_EXPANDED_WIDTH);
  assert.ok(CARD_EXPANDED_WIDTH > CARD_WIDTH, "expanding should actually be wider");
});

test("rows are spaced by the exported constants", () => {
  const people = [
    makePerson({ id: "parent", name: "Parent" }),
    makePerson({ id: "child", name: "Child", parentIds: ["parent"] }),
  ];
  const layout = buildTreeLayout(people);

  assert.equal(findCard(layout, "parent").y, 0);
  assert.equal(findCard(layout, "child").y, CARD_HEIGHT + ROW_GAP);
  assert.equal(layout.cardWidth, CARD_WIDTH);
  assert.equal(layout.cardHeight, CARD_HEIGHT);
});
