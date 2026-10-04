import type { PersonDoc } from "./types.js";

export const CARD_WIDTH = 184;
export const CARD_HEIGHT = 92;
export const COL_GAP = 24;
export const ROW_GAP = 96;

/**
 * How wide a card may grow when hovered. Lives here rather than only in
 * CSS because the layout has to know how much room an expansion needs in
 * order to decide which edge a card should grow from.
 */
export const CARD_EXPANDED_WIDTH = 272;

/** Elbow rounding, clamped per-corner so short runs can't overshoot. */
const CORNER = 12;

export interface PersonCard {
  person: PersonDoc;
  generation: number;
  /** Left-to-right ordering rank, not a pixel grid slot — see computeXPositions. */
  column: number;
  x: number;
  y: number;
  /**
   * Distance from the card's right edge to the canvas's right edge. A card
   * with less slack than a hover expansion needs is pinned by its right
   * edge instead, so it grows inward rather than off the end of the tree.
   */
  rightInset: number;
  anchorRight: boolean;
}

export interface TreeConnector {
  /** SVG path data — rounded elbows rather than hard right angles. */
  d: string;
  kind: "parent" | "partner";
  /** Midpoint of a partner link, where the heart sits. */
  markX?: number;
  markY?: number;
}

export interface TreeLayout {
  cards: PersonCard[];
  connectors: TreeConnector[];
  width: number;
  height: number;
  cardWidth: number;
  cardHeight: number;
  cardExpandedWidth: number;
}

/**
 * Fixed-point relaxation, bounded by people.length iterations (which
 * doubles as a cycle guard). Two rules, both of which only ever push
 * generation numbers up, so this always converges:
 *  1. a person's generation >= max(parents' generation) + 1
 *  2. partners are pulled to the max of their linked generations
 */
export function computeGenerations(people: PersonDoc[]): Map<string, number> {
  const gen = new Map(people.map((p) => [p.id, 0]));

  for (let i = 0; i < people.length; i++) {
    let changed = false;

    for (const person of people) {
      const parentGens = person.parentIds
        .map((id) => gen.get(id))
        .filter((g): g is number => g !== undefined);
      if (parentGens.length === 0) continue;
      const required = Math.max(...parentGens) + 1;
      if (required > gen.get(person.id)!) {
        gen.set(person.id, required);
        changed = true;
      }
    }

    for (const person of people) {
      const partnerGens = person.partnerIds
        .map((id) => gen.get(id))
        .filter((g): g is number => g !== undefined);
      if (partnerGens.length === 0) continue;
      const required = Math.max(gen.get(person.id)!, ...partnerGens);
      if (required > gen.get(person.id)!) {
        gen.set(person.id, required);
        changed = true;
      }
    }

    if (!changed) break;
  }

  return gen;
}

/**
 * The relaxation rules above guarantee convergence but say nothing about
 * contiguity: an unrelated, deeply-recorded branch can leave empty
 * generation rows elsewhere in the data. Remapping the distinct generation
 * values that actually occur to consecutive integers avoids wasted blank
 * rows. Monotonic, so relative generation order is preserved.
 */
export function compactGenerations(gen: Map<string, number>): Map<string, number> {
  const distinct = Array.from(new Set(gen.values())).sort((a, b) => a - b);
  const remap = new Map(distinct.map((g, i) => [g, i]));
  const compacted = new Map<string, number>();
  for (const [id, g] of gen) {
    compacted.set(id, remap.get(g)!);
  }
  return compacted;
}

/**
 * DFS pre-order placement from generation-0 roots — each person's partners
 * (including partner-of-partner chains, for blended families) are placed
 * adjacent, then their children are placed grouped by exact parentIds set
 * (not row position), so a person who had children with two different
 * partners produces two visually distinct sibling clusters.
 *
 * This is a simple deterministic heuristic, not a crossing-minimizing
 * layout (general layered-DAG drawing is NP-hard) — fine for a
 * family-sized tree; complex blended-family cases may show a long or
 * crossing connector.
 */
export function computeColumns(people: PersonDoc[]): Map<string, number> {
  const byId = new Map(people.map((p) => [p.id, p]));
  const column = new Map<string, number>();
  const visited = new Set<string>();
  let nextColumn = 0;

  const byNameThenId = (a: PersonDoc, b: PersonDoc) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

  function childrenGroups(unitIds: string[]): PersonDoc[][] {
    const groups = new Map<string, PersonDoc[]>();
    const candidates = [...people].sort(byNameThenId);
    for (const p of candidates) {
      if (visited.has(p.id) || p.parentIds.length === 0) continue;
      if (!p.parentIds.some((pid) => unitIds.includes(pid))) continue;
      const key = [...p.parentIds].sort().join(",");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, members]) => members);
  }

  function placeFamilyUnit(rootId: string): void {
    if (visited.has(rootId)) return;

    const unitIds: string[] = [];
    visited.add(rootId);
    column.set(rootId, nextColumn++);
    unitIds.push(rootId);

    const queue = [...byId.get(rootId)!.partnerIds];
    while (queue.length > 0) {
      const partnerId = queue.shift()!;
      if (visited.has(partnerId) || !byId.has(partnerId)) continue;
      visited.add(partnerId);
      column.set(partnerId, nextColumn++);
      unitIds.push(partnerId);
      queue.push(...byId.get(partnerId)!.partnerIds);
    }

    for (const group of childrenGroups(unitIds)) {
      for (const child of group) {
        placeFamilyUnit(child.id);
      }
    }
  }

  const roots = people.filter((p) => p.parentIds.length === 0).sort(byNameThenId);
  for (const root of roots) {
    placeFamilyUnit(root.id);
  }
  // Safety net for anyone the root walk didn't reach (e.g. a parent id
  // pointing at a deleted person), so this function stays total.
  for (const p of [...people].sort(byNameThenId)) {
    placeFamilyUnit(p.id);
  }

  return column;
}

function sameMembers(a: string[], b: string[]): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  const set = new Set(b);
  return a.every((id) => set.has(id));
}

/**
 * Turns the DFS *ordering* from computeColumns into actual x positions.
 *
 * computeColumns alone gives every person a globally unique column, so an
 * only child drifts a column further right in each generation and a tree
 * gets much wider than it needs to be. Here each generation instead packs
 * from the left independently, and parents are centred over the children
 * they already placed — a cut-down Reingold-Tilford pass.
 *
 * Generations are walked deepest-first, which guarantees every child has a
 * position before its parents need one. That holds even when a parent sits
 * more than one generation above its child, which computeGenerations
 * allows (a child lands one row below its *deepest* parent).
 */
export function computeXPositions(
  people: PersonDoc[],
  gen: Map<string, number>,
  order: Map<string, number>,
): Map<string, number> {
  const stride = CARD_WIDTH + COL_GAP;
  const byId = new Map(people.map((p) => [p.id, p]));

  const childrenOf = new Map<string, string[]>();
  for (const person of people) {
    for (const parentId of person.parentIds) {
      if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
      childrenOf.get(parentId)!.push(person.id);
    }
  }

  const rows = new Map<number, string[]>();
  for (const person of people) {
    const g = gen.get(person.id)!;
    if (!rows.has(g)) rows.set(g, []);
    rows.get(g)!.push(person.id);
  }
  for (const row of rows.values()) {
    row.sort((a, b) => order.get(a)! - order.get(b)!);
  }

  const x = new Map<string, number>();

  /** Midpoint of the already-placed children, or null if none are. */
  function childCenter(ids: string[]): number | null {
    const centers = ids.filter((id) => x.has(id)).map((id) => x.get(id)! + CARD_WIDTH / 2);
    if (centers.length === 0) return null;
    return (Math.min(...centers) + Math.max(...centers)) / 2;
  }

  const generations = Array.from(rows.keys()).sort((a, b) => b - a);
  for (const g of generations) {
    const row = rows.get(g)!;
    // Left edge the next card may occupy, so a centred parent can never
    // land on top of the neighbour already placed to its left.
    let cursor = 0;
    let i = 0;

    while (i < row.length) {
      const id = row[i]!;
      const kids = childrenOf.get(id) ?? [];
      const nextId = row[i + 1];

      // A couple raising the same children is centred as a single unit,
      // so the pair straddles its children rather than one partner
      // hogging the centre and shoving the other off to the side.
      const asCouple =
        nextId !== undefined &&
        byId.get(id)!.partnerIds.includes(nextId) &&
        sameMembers(kids, childrenOf.get(nextId) ?? []);

      if (asCouple) {
        const center = childCenter(kids);
        const desired = center === null ? cursor : center - (stride + CARD_WIDTH) / 2;
        const left = Math.max(desired, cursor);
        x.set(id, left);
        x.set(nextId!, left + stride);
        cursor = left + 2 * stride;
        i += 2;
      } else {
        const center = childCenter(kids);
        const desired = center === null ? cursor : center - CARD_WIDTH / 2;
        const left = Math.max(desired, cursor);
        x.set(id, left);
        cursor = left + stride;
        i += 1;
      }
    }
  }

  // Centring can push a row left of zero; slide everything back flush.
  const minX = Math.min(...x.values());
  if (minX !== 0) {
    for (const [id, value] of x) x.set(id, value - minX);
  }
  return x;
}

/**
 * One path from the parents' trunk, along the bus, and down to a child,
 * with the turn rounded. Emitting a single path per child (rather than
 * separate bus + stub segments) is what lets the corner be curved at all.
 */
function childElbow(anchorX: number, busY: number, childX: number, childTop: number): string {
  if (childX === anchorX) {
    return `M ${anchorX} ${busY} L ${childX} ${childTop}`;
  }
  const dir = childX > anchorX ? 1 : -1;
  const r = Math.min(CORNER, Math.abs(childX - anchorX), Math.abs(childTop - busY));
  return [
    `M ${anchorX} ${busY}`,
    `L ${childX - dir * r} ${busY}`,
    `Q ${childX} ${busY} ${childX} ${busY + r}`,
    `L ${childX} ${childTop}`,
  ].join(" ");
}

export function buildTreeLayout(people: PersonDoc[]): TreeLayout {
  if (people.length === 0) {
    return {
      cards: [],
      connectors: [],
      width: 0,
      height: 0,
      cardWidth: CARD_WIDTH,
      cardHeight: CARD_HEIGHT,
      cardExpandedWidth: CARD_EXPANDED_WIDTH,
    };
  }

  const gen = compactGenerations(computeGenerations(people));
  // computeColumns supplies the left-to-right *ordering* within each row;
  // computeXPositions turns that into compact, parent-centred positions.
  const column = computeColumns(people);
  const xs = computeXPositions(people, gen, column);

  const contentWidth = Math.max(...xs.values()) + CARD_WIDTH;
  const growth = CARD_EXPANDED_WIDTH - CARD_WIDTH;

  const cards: PersonCard[] = people.map((person) => {
    const generation = gen.get(person.id)!;
    const x = xs.get(person.id)!;
    const rightInset = contentWidth - (x + CARD_WIDTH);
    return {
      person,
      generation,
      column: column.get(person.id)!,
      x,
      y: generation * (CARD_HEIGHT + ROW_GAP),
      rightInset,
      // Only flip when growing right would run off the tree AND there is
      // room to grow left instead, so a lone card never gets pushed
      // negative.
      anchorRight: rightInset < growth && x >= growth,
    };
  });

  const cardById = new Map(cards.map((c) => [c.person.id, c]));
  const connectors: TreeConnector[] = [];

  const seenPairs = new Set<string>();
  for (const card of cards) {
    for (const partnerId of card.person.partnerIds) {
      const key = [card.person.id, partnerId].sort().join("|");
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      const partnerCard = cardById.get(partnerId);
      if (!partnerCard) continue;
      const [left, right] = card.x <= partnerCard.x ? [card, partnerCard] : [partnerCard, card];
      const x1 = left.x + CARD_WIDTH;
      const y1 = left.y + CARD_HEIGHT / 2;
      const x2 = right.x;
      const y2 = right.y + CARD_HEIGHT / 2;
      connectors.push({
        d: `M ${x1} ${y1} L ${x2} ${y2}`,
        kind: "partner",
        markX: (x1 + x2) / 2,
        markY: (y1 + y2) / 2,
      });
    }
  }

  const childGroups = new Map<string, PersonCard[]>();
  for (const card of cards) {
    if (card.person.parentIds.length === 0) continue;
    const key = [...card.person.parentIds].sort().join(",");
    if (!childGroups.has(key)) childGroups.set(key, []);
    childGroups.get(key)!.push(card);
  }

  for (const [key, children] of childGroups) {
    const parentCards = key
      .split(",")
      .map((id) => cardById.get(id))
      .filter((c): c is PersonCard => !!c);
    if (parentCards.length === 0) continue;

    const parentCenters = parentCards.map((c) => c.x + CARD_WIDTH / 2);
    const parentBottom = Math.max(...parentCards.map((c) => c.y)) + CARD_HEIGHT;
    const busY = parentBottom + ROW_GAP / 2;
    const anchorX = (Math.min(...parentCenters) + Math.max(...parentCenters)) / 2;

    // Each parent drops onto the bus at its own x...
    for (const p of parentCards) {
      const px = p.x + CARD_WIDTH / 2;
      connectors.push({ d: `M ${px} ${p.y + CARD_HEIGHT} L ${px} ${busY}`, kind: "parent" });
    }
    // ...joined along the bus when there's more than one of them.
    if (parentCards.length > 1) {
      connectors.push({
        d: `M ${Math.min(...parentCenters)} ${busY} L ${Math.max(...parentCenters)} ${busY}`,
        kind: "parent",
      });
    }

    for (const c of children) {
      connectors.push({
        d: childElbow(anchorX, busY, c.x + CARD_WIDTH / 2, c.y),
        kind: "parent",
      });
    }
  }

  const height = Math.max(...cards.map((c) => c.y)) + CARD_HEIGHT;

  return {
    cards,
    connectors,
    width: contentWidth,
    height,
    cardWidth: CARD_WIDTH,
    cardHeight: CARD_HEIGHT,
    cardExpandedWidth: CARD_EXPANDED_WIDTH,
  };
}
