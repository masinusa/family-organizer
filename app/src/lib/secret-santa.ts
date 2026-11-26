/**
 * Secret Santa rules, kept pure — no Firestore — so the draw and every
 * "who may see what" decision are unit-testable. Routes read assignments
 * only through the helpers here, and each one answers for a single viewer.
 */
import type { PersonDoc, SecretSantaDoc } from "./types.js";

export const NO_VALID_DRAW_ERROR =
  "No draw fits the rules (nobody gets their partner or last year's person). Assign by hand instead.";
export const TOO_FEW_ERROR = "Add at least two people before drawing names.";

/** A directed "giver may not draw receiver" pair. */
export function pairKey(giverId: string, receiverId: string): string {
  return `${giverId}>${receiverId}`;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Generous for a family-sized draw, and the bound on an impossible one:
 * backtracking over a set of rules nobody can satisfy would otherwise try
 * every permutation before giving up.
 */
const MAX_STEPS = 200_000;

/**
 * Everyone gives once and receives once, nobody draws themselves, and no
 * `forbidden` pair is used. Randomised backtracking: givers and each
 * giver's candidates are shuffled, so every valid outcome can come up.
 */
export function drawAssignments(
  participantIds: string[],
  forbidden: ReadonlySet<string>,
  rng: () => number = Math.random,
): Record<string, string> {
  if (participantIds.length < 2) throw new Error(TOO_FEW_ERROR);

  const givers = shuffle(participantIds, rng);
  const taken = new Set<string>();
  const result: Record<string, string> = {};
  let steps = 0;

  const place = (index: number): boolean => {
    if (index === givers.length) return true;
    const giver = givers[index]!;
    for (const receiver of shuffle(participantIds, rng)) {
      if (++steps > MAX_STEPS) return false;
      if (receiver === giver || taken.has(receiver) || forbidden.has(pairKey(giver, receiver))) continue;
      taken.add(receiver);
      result[giver] = receiver;
      if (place(index + 1)) return true;
      taken.delete(receiver);
      delete result[giver];
    }
    return false;
  };

  if (!place(0)) throw new Error(NO_VALID_DRAW_ERROR);
  return result;
}

/**
 * The draw's rules: nobody gets someone they're linked to sideways on the
 * tree (a partner, usually), and nobody gets the person they had last year.
 * Both directions for partners; last year's only as it was drawn.
 */
export function drawExclusions(
  participantIds: string[],
  people: PersonDoc[],
  lastYear: Record<string, string> | null,
): Set<string> {
  const inExchange = new Set(participantIds);
  const forbidden = new Set<string>();
  for (const person of people) {
    if (!inExchange.has(person.id)) continue;
    for (const otherId of person.connectionIds) {
      if (!inExchange.has(otherId)) continue;
      forbidden.add(pairKey(person.id, otherId));
      forbidden.add(pairKey(otherId, person.id));
    }
  }
  for (const [giver, receiver] of Object.entries(lastYear ?? {})) {
    if (inExchange.has(giver) && inExchange.has(receiver)) forbidden.add(pairKey(giver, receiver));
  }
  return forbidden;
}

/**
 * A saved set of assignments has to be a whole draw: every participant
 * gives exactly once and receives exactly once, and nobody has themselves.
 * Returns the reason it isn't, or null.
 */
export function assignmentError(participantIds: string[], assignments: Record<string, string>): string | null {
  const inExchange = new Set(participantIds);
  const givers = Object.keys(assignments);
  if (givers.length !== participantIds.length || !participantIds.every((id) => id in assignments)) {
    return "Everyone needs somebody to buy for.";
  }
  const receivers = new Set<string>();
  for (const giver of givers) {
    const receiver = assignments[giver]!;
    if (!inExchange.has(receiver)) return "Everyone has to buy for somebody in the exchange.";
    if (receiver === giver) return "Nobody can buy for themselves.";
    if (receivers.has(receiver)) return "Two people are buying for the same person.";
    receivers.add(receiver);
  }
  return null;
}

/** Pairs an admin's hand edit uses despite the rules — shown, not blocked. */
export function brokenRules(assignments: Record<string, string>, forbidden: ReadonlySet<string>): Array<[string, string]> {
  return Object.entries(assignments).filter(([giver, receiver]) => forbidden.has(pairKey(giver, receiver)));
}

/** Drops any pair that names someone no longer in the exchange. */
export function prunedAssignments(
  participantIds: string[],
  assignments: Record<string, string>,
): Record<string, string> {
  const inExchange = new Set(participantIds);
  return Object.fromEntries(
    Object.entries(assignments).filter(([giver, receiver]) => inExchange.has(giver) && inExchange.has(receiver)),
  );
}

export function isParticipant(exchange: SecretSantaDoc, personId: string): boolean {
  return exchange.participantIds.includes(personId);
}

/** Who this viewer is buying for — the only assignment they may see. */
export function recipientOf(exchange: SecretSantaDoc, personId: string): string | null {
  return exchange.assignments[personId] ?? null;
}

/**
 * Who is buying for this person. Server-side only — it keys the
 * recipient's side of the anonymous thread, and must never reach their
 * page in any form (a name, an id, a form action).
 */
export function santaOf(exchange: SecretSantaDoc, personId: string): string | null {
  return Object.entries(exchange.assignments).find(([, receiver]) => receiver === personId)?.[0] ?? null;
}

export const MESSAGE_MAX = 1000;
export const THREAD_MAX = 200;

export function parseMessage(raw: unknown): string | { error: string } {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { error: "Write something first." };
  if (text.length > MESSAGE_MAX) return { error: `Keep a note to ${MESSAGE_MAX} characters.` };
  return text;
}

/**
 * Participants with nobody to buy for, or nobody buying for them: what an
 * admin has to fix after changing who's in once names were drawn.
 */
export function unassignedIds(exchange: SecretSantaDoc): string[] {
  const receiving = new Set(Object.values(exchange.assignments));
  return exchange.participantIds.filter((id) => !(id in exchange.assignments) || !receiving.has(id));
}

/* ------------------------------ input ------------------------------ */

export const MAX_BUDGET = 10_000;

export interface ExchangeDetails {
  budget: number | null;
  exchangeDate: string | null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A real calendar day in "YYYY-MM-DD" — the shape `<input type="date">` posts. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseDetails(body: Record<string, unknown>): ExchangeDetails | { error: string } {
  const rawBudget = str(body.budget).replace(/^\$/, "");
  const budget = Number(rawBudget);
  if (rawBudget && (!Number.isInteger(budget) || budget < 1 || budget > MAX_BUDGET)) {
    return { error: `A budget is a whole number of dollars, up to ${MAX_BUDGET}.` };
  }
  const exchangeDate = str(body.exchangeDate);
  if (exchangeDate && !isCalendarDate(exchangeDate)) {
    return { error: "That isn't a date." };
  }
  return { budget: rawBudget ? budget : null, exchangeDate: exchangeDate || null };
}

/**
 * The "show all" table posts one `to:<giverId>` select per participant.
 * Only participants' rows are read, so a hand-posted extra field can't
 * add a giver; the result still has to pass assignmentError.
 */
export function parseAssignments(body: Record<string, unknown>, participantIds: string[]): Record<string, string> {
  const assignments: Record<string, string> = {};
  for (const giver of participantIds) {
    const receiver = str(body[`to:${giver}`]);
    if (receiver) assignments[giver] = receiver;
  }
  return assignments;
}

/** "Thu, Dec 24" for a stored calendar day. */
export function formatExchangeDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
