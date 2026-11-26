import { Timestamp, type DocumentData } from "@google-cloud/firestore";
import { firestore } from "./firestore.js";
import { prunedAssignments } from "./secret-santa.js";
import type { SecretSantaDoc } from "./types.js";

const exchanges = () => firestore.collection("secretSantas");

function toExchange(data: DocumentData): SecretSantaDoc {
  return {
    year: data.year,
    budget: data.budget,
    exchangeDate: data.exchangeDate,
    participantIds: data.participantIds,
    assignments: data.assignments,
    drawnAt: data.drawnAt ? (data.drawnAt as Timestamp).toDate() : null,
    createdBy: data.createdBy,
    createdAt: (data.createdAt as Timestamp).toDate(),
    updatedAt: (data.updatedAt as Timestamp).toDate(),
  };
}

export async function getExchange(year: number): Promise<SecretSantaDoc | null> {
  const snap = await exchanges().doc(String(year)).get();
  return snap.exists ? toExchange(snap.data()!) : null;
}

/** Newest first. One a year, so this stays tiny. */
export async function listExchanges(): Promise<SecretSantaDoc[]> {
  const snapshot = await exchanges().orderBy("year", "desc").get();
  return snapshot.docs.map((doc) => toExchange(doc.data()));
}

/**
 * Whether this person is in any exchange — what lets a friend through the
 * feature gate to /christmas, and what stops them (or anyone) being
 * deleted out from under an exchange that still names them.
 */
export async function isParticipantAnywhere(personId: string): Promise<boolean> {
  const snapshot = await exchanges().where("participantIds", "array-contains", personId).limit(1).get();
  return !snapshot.empty;
}

export const EXCHANGE_EXISTS_ERROR = "There's already a Secret Santa for that year.";

export async function createExchange(year: number, createdBy: string): Promise<void> {
  const ref = exchanges().doc(String(year));
  const now = Timestamp.now();
  await firestore.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) throw new Error(EXCHANGE_EXISTS_ERROR);
    tx.set(ref, {
      year,
      budget: null,
      exchangeDate: null,
      participantIds: [],
      assignments: {},
      drawnAt: null,
      createdBy,
      createdAt: now,
      updatedAt: now,
    });
  });
}

export async function setDetails(year: number, budget: number | null, exchangeDate: string | null): Promise<void> {
  await exchanges().doc(String(year)).update({ budget, exchangeDate, updatedAt: Timestamp.now() });
}

/**
 * Keeps every pair that still makes sense rather than redrawing: taking
 * one person out shouldn't reshuffle everybody else's, and some may
 * already have bought something. Pairs naming someone who left go, and the
 * page says who's left without one.
 */
export async function setParticipants(year: number, participantIds: string[]): Promise<void> {
  const ref = exchanges().doc(String(year));
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error(`No Secret Santa for ${year}.`);
    const current = toExchange(snap.data()!);
    tx.update(ref, {
      participantIds,
      assignments: prunedAssignments(participantIds, current.assignments),
      updatedAt: Timestamp.now(),
    });
  });
}

/** `drawn` stamps drawnAt — a fresh draw, as opposed to an admin's hand edit. */
export async function setAssignments(year: number, assignments: Record<string, string>, drawn: boolean): Promise<void> {
  const now = Timestamp.now();
  await exchanges()
    .doc(String(year))
    .update({ assignments, ...(drawn ? { drawnAt: now } : {}), updatedAt: now });
}

/** Object form so tests can stub a method — see users-repo.ts for why. */
export const secretSantaRepo = {
  getExchange,
  listExchanges,
  isParticipantAnywhere,
  createExchange,
  setDetails,
  setParticipants,
  setAssignments,
};
