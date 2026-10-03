import type { PersonDoc } from "./types.js";

export const CARD_WIDTH = 168;
export const CARD_HEIGHT = 68;
export const COL_GAP = 28;
export const ROW_GAP = 88;

export interface PersonCard {
  person: PersonDoc;
  generation: number;
  column: number;
  x: number;
  y: number;
}

export interface TreeLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TreeLayout {
  cards: PersonCard[];
  connectors: TreeLine[];
  width: number;
  height: number;
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
  // Safety net for data the relaxation loop above didn't reach (shouldn't
  // happen given parentIds always reference real people, but keeps this
  // function total).
  for (const p of [...people].sort(byNameThenId)) {
    placeFamilyUnit(p.id);
  }

  return column;
}

export function buildTreeLayout(people: PersonDoc[]): TreeLayout {
  if (people.length === 0) {
    return { cards: [], connectors: [], width: 0, height: 0 };
  }

  const gen = compactGenerations(computeGenerations(people));
  const column = computeColumns(people);

  const cards: PersonCard[] = people.map((person) => {
    const generation = gen.get(person.id)!;
    const col = column.get(person.id)!;
    return {
      person,
      generation,
      column: col,
      x: col * (CARD_WIDTH + COL_GAP),
      y: generation * (CARD_HEIGHT + ROW_GAP),
    };
  });

  const cardById = new Map(cards.map((c) => [c.person.id, c]));
  const connectors: TreeLine[] = [];

  const seenPairs = new Set<string>();
  for (const card of cards) {
    for (const partnerId of card.person.partnerIds) {
      const key = [card.person.id, partnerId].sort().join("|");
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      const partnerCard = cardById.get(partnerId);
      if (!partnerCard) continue;
      connectors.push({
        x1: card.x + CARD_WIDTH,
        y1: card.y + CARD_HEIGHT / 2,
        x2: partnerCard.x,
        y2: partnerCard.y + CARD_HEIGHT / 2,
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

    const parentBottom = Math.max(...parentCards.map((c) => c.y)) + CARD_HEIGHT;
    const busY = parentBottom + ROW_GAP / 2;

    for (const p of parentCards) {
      connectors.push({ x1: p.x + CARD_WIDTH / 2, y1: p.y + CARD_HEIGHT, x2: p.x + CARD_WIDTH / 2, y2: busY });
    }

    const busXs = [...parentCards, ...children].map((c) => c.x + CARD_WIDTH / 2);
    connectors.push({ x1: Math.min(...busXs), y1: busY, x2: Math.max(...busXs), y2: busY });

    for (const c of children) {
      connectors.push({ x1: c.x + CARD_WIDTH / 2, y1: busY, x2: c.x + CARD_WIDTH / 2, y2: c.y });
    }
  }

  const width = Math.max(...cards.map((c) => c.x)) + CARD_WIDTH;
  const height = Math.max(...cards.map((c) => c.y)) + CARD_HEIGHT;

  return { cards, connectors, width, height };
}
