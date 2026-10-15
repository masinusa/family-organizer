import { FieldValue, Timestamp, type DocumentData } from "@google-cloud/firestore";
import { firestore } from "./firestore.js";
import { normalizeEmail } from "./email.js";
import type { PersonDoc, PersonaInput } from "./types.js";

const peopleCollection = () => firestore.collection("people");

/**
 * A person doc written before the `partnerIds` -> `connectionIds` rename
 * is a bug, not a shape to tolerate: it means the one-off
 * `npm run migrate:connections` has not been run against this deployment.
 * Throwing says so, where defaulting to `[]` would quietly erase whoever
 * that person is linked to.
 */
function requireConnectionIds(id: string, data: DocumentData): string[] {
  if (!Array.isArray(data.connectionIds)) {
    throw new Error(`Person ${id} has no connectionIds — run "npm run migrate:connections".`);
  }
  return data.connectionIds as string[];
}

function toPersonDoc(id: string, data: DocumentData): PersonDoc {
  return {
    id,
    name: data.name,
    email: data.email ?? null,
    blurb: data.blurb ?? null,
    birthMonth: data.birthMonth ?? null,
    birthDay: data.birthDay ?? null,
    birthYear: data.birthYear ?? null,
    color: data.color ?? null,
    parentIds: data.parentIds ?? [],
    connectionIds: requireConnectionIds(id, data),
    createdAt: (data.createdAt as Timestamp).toDate(),
    updatedAt: (data.updatedAt as Timestamp).toDate(),
  };
}

export async function listPeople(): Promise<PersonDoc[]> {
  const snapshot = await peopleCollection().get();
  return snapshot.docs.map((doc) => toPersonDoc(doc.id, doc.data()));
}

export async function getPerson(id: string): Promise<PersonDoc | null> {
  const snap = await peopleCollection().doc(id).get();
  return snap.exists ? toPersonDoc(snap.id, snap.data()!) : null;
}

export async function createPerson(name: string, email: string | null): Promise<PersonDoc> {
  const now = Timestamp.now();
  const data = {
    name,
    email: email ? normalizeEmail(email) : null,
    blurb: null,
    birthMonth: null,
    birthDay: null,
    birthYear: null,
    color: null,
    parentIds: [] as string[],
    connectionIds: [] as string[],
    createdAt: now,
    updatedAt: now,
  };
  const ref = await peopleCollection().add(data);
  return toPersonDoc(ref.id, data);
}

/** The self-service fields — see canEditPersona for who may call this. */
export async function updatePersona(id: string, input: PersonaInput): Promise<void> {
  await peopleCollection().doc(id).update({
    name: input.name,
    blurb: input.blurb,
    birthMonth: input.birthMonth,
    birthDay: input.birthDay,
    birthYear: input.birthYear,
    color: input.color,
    updatedAt: Timestamp.now(),
  });
}

/**
 * Admin-only, and separate from the persona: changing this email is what
 * links or unlinks the person from a sign-in account (lib/family-link.ts),
 * so it is normalized to match how `users` doc ids are keyed.
 */
export async function setEmail(id: string, email: string | null): Promise<void> {
  await peopleCollection().doc(id).update({
    email: email ? normalizeEmail(email) : null,
    updatedAt: Timestamp.now(),
  });
}

export const TOO_MANY_PARENTS_ERROR = "A person can have at most 2 parents.";
export const SELF_PARENT_ERROR = "A person cannot be their own parent.";
export const CYCLE_PARENT_ERROR = "That would create a cycle (a descendant can't also be a parent).";
export const SELF_CONNECTION_ERROR = "Pick someone other than themselves.";
export const MISSING_PERSON_ERROR = "That person is no longer on the tree.";

/**
 * BFS over parentIds edges to find everyone descended from `personId`.
 * Pure — no Firestore access — so it's unit-testable without an emulator,
 * same pattern as isLastAdmin in users-repo.ts. Used to reject a parent
 * assignment that would create a cycle.
 */
export function findDescendantIds(personId: string, people: PersonDoc[]): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const person of people) {
    for (const parentId of person.parentIds) {
      if (!childrenByParent.has(parentId)) {
        childrenByParent.set(parentId, []);
      }
      childrenByParent.get(parentId)!.push(person.id);
    }
  }

  const descendants = new Set<string>();
  const queue = [...(childrenByParent.get(personId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (descendants.has(id)) continue;
    descendants.add(id);
    queue.push(...(childrenByParent.get(id) ?? []));
  }
  return descendants;
}

export async function setParents(personId: string, parentIds: string[]): Promise<void> {
  const deduped = Array.from(new Set(parentIds));
  if (deduped.length > 2) {
    throw new Error(TOO_MANY_PARENTS_ERROR);
  }
  if (deduped.includes(personId)) {
    throw new Error(SELF_PARENT_ERROR);
  }

  const people = await listPeople();
  const descendants = findDescendantIds(personId, people);
  if (deduped.some((id) => descendants.has(id))) {
    throw new Error(CYCLE_PARENT_ERROR);
  }

  await peopleCollection().doc(personId).update({ parentIds: deduped, updatedAt: Timestamp.now() });
}

/**
 * The relationship editor adds and removes one link at a time, but every
 * rule about parents (at most two, no self, no cycles) is a property of
 * the whole set — so both of these read the current set and hand it to
 * setParents rather than validating an edge on its own.
 */
export async function addParents(personId: string, parentIds: string[]): Promise<void> {
  const person = await getPerson(personId);
  if (!person) {
    throw new Error(MISSING_PERSON_ERROR);
  }
  await setParents(personId, [...person.parentIds, ...parentIds]);
}

export async function removeParent(personId: string, parentId: string): Promise<void> {
  const person = await getPerson(personId);
  if (!person) {
    throw new Error(MISSING_PERSON_ERROR);
  }
  await setParents(
    personId,
    person.parentIds.filter((id) => id !== parentId),
  );
}

/**
 * Reciprocal: a connection one way is the same connection the other, so
 * both docs are edited in one batch and neither side is the owner.
 */
export async function addConnection(personId: string, otherId: string): Promise<void> {
  if (personId === otherId) {
    throw new Error(SELF_CONNECTION_ERROR);
  }
  const now = Timestamp.now();
  const batch = firestore.batch();
  batch.update(peopleCollection().doc(personId), { connectionIds: FieldValue.arrayUnion(otherId), updatedAt: now });
  batch.update(peopleCollection().doc(otherId), { connectionIds: FieldValue.arrayUnion(personId), updatedAt: now });
  await batch.commit();
}

export async function removeConnection(personId: string, otherId: string): Promise<void> {
  const now = Timestamp.now();
  const batch = firestore.batch();
  batch.update(peopleCollection().doc(personId), { connectionIds: FieldValue.arrayRemove(otherId), updatedAt: now });
  batch.update(peopleCollection().doc(otherId), { connectionIds: FieldValue.arrayRemove(personId), updatedAt: now });
  await batch.commit();
}

/**
 * Children aren't cascade-deleted — they just lose one parent link. Every
 * reference to `id` (as a parent or a connection) is stripped before the
 * doc itself is removed, so no dangling ids remain.
 */
export async function deletePerson(id: string): Promise<void> {
  const now = Timestamp.now();
  const batch = firestore.batch();

  const childrenSnap = await peopleCollection().where("parentIds", "array-contains", id).get();
  for (const doc of childrenSnap.docs) {
    batch.update(doc.ref, { parentIds: FieldValue.arrayRemove(id), updatedAt: now });
  }

  const connectedSnap = await peopleCollection().where("connectionIds", "array-contains", id).get();
  for (const doc of connectedSnap.docs) {
    batch.update(doc.ref, { connectionIds: FieldValue.arrayRemove(id), updatedAt: now });
  }

  batch.delete(peopleCollection().doc(id));
  await batch.commit();
}

/**
 * Object form of the functions above, exported so callers that need to
 * stub a method in tests can (see users-repo.ts for why).
 */
export const peopleRepo = {
  listPeople,
  getPerson,
  createPerson,
  updatePersona,
  setEmail,
  setParents,
  addParents,
  removeParent,
  addConnection,
  removeConnection,
  deletePerson,
};
