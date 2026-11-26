import { Timestamp, type CollectionReference, type DocumentData } from "@google-cloud/firestore";
import { firestore } from "./firestore.js";
import type {
  PasswordVersionDoc,
  RevealAction,
  RevealDoc,
  SubscriptionDoc,
  SubscriptionInput,
} from "./types.js";

const subscriptionsCollection = () => firestore.collection("subscriptions");
const revealsCollection = (subscriptionId: string) =>
  subscriptionsCollection().doc(subscriptionId).collection("reveals");
const passwordsCollection = (subscriptionId: string) =>
  subscriptionsCollection().doc(subscriptionId).collection("passwords");

function toSubscriptionDoc(id: string, data: DocumentData): SubscriptionDoc {
  return {
    id,
    name: data.name,
    accountEmail: data.accountEmail ?? null,
    accountPhone: data.accountPhone ?? null,
    link: data.link ?? null,
    notes: data.notes ?? null,
    mailFrom: data.mailFrom ?? null,
    hasPassword: data.hasPassword === true,
    memberEmails: Array.isArray(data.memberEmails) ? data.memberEmails : [],
    createdBy: data.createdBy,
    createdAt: (data.createdAt as Timestamp).toDate(),
    updatedAt: (data.updatedAt as Timestamp).toDate(),
  };
}

/**
 * `version` is nullable by design — null is "the current password", and
 * every mail read — but it must be *present*. A reveal written before the
 * password history has no such field, and reading that absence as "the
 * current one" would put a claim in the audit trail that nothing supports.
 * Per AGENTS.md: surface it, don't default it. There is nothing to migrate,
 * so the fix is to clear the subcollection.
 */
function requireVersion(id: string, data: DocumentData): string | null {
  if (!("version" in data)) {
    throw new Error(`Reveal ${id} predates the password history — clear this subscription's reveals.`);
  }
  return data.version;
}

function toRevealDoc(id: string, data: DocumentData): RevealDoc {
  return {
    id,
    email: data.email,
    action: data.action,
    version: requireVersion(id, data),
    at: (data.at as Timestamp).toDate(),
  };
}

function toPasswordVersionDoc(data: DocumentData): PasswordVersionDoc {
  return {
    version: data.version,
    setBy: data.setBy,
    at: (data.at as Timestamp).toDate(),
  };
}

/**
 * Every subscription, ordered by name. Callers filter by viewer in memory
 * (lib/subscription-access.ts) rather than pushing an `array-contains` down
 * to Firestore: combining that with this `orderBy` would need a composite
 * index, and at family scale over-fetching is the better trade — the same
 * call made in events-repo's listInRange. Nothing in these docs is secret,
 * so reading them all inside the server leaks nothing.
 *
 * Note `orderBy("name")` silently excludes a doc with no `name` field, so
 * every write below must set it.
 */
export async function listSubscriptions(): Promise<SubscriptionDoc[]> {
  const snapshot = await subscriptionsCollection().orderBy("name").get();
  return snapshot.docs.map((doc) => toSubscriptionDoc(doc.id, doc.data()));
}

export async function getSubscription(id: string): Promise<SubscriptionDoc | null> {
  const snap = await subscriptionsCollection().doc(id).get();
  return snap.exists ? toSubscriptionDoc(snap.id, snap.data()!) : null;
}

export async function createSubscription(
  input: SubscriptionInput,
  createdBy: string,
  memberEmails: string[] = [],
): Promise<string> {
  const now = Timestamp.now();
  const ref = await subscriptionsCollection().add({
    ...input,
    hasPassword: false,
    memberEmails,
    createdBy,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function updateSubscription(id: string, input: SubscriptionInput): Promise<void> {
  await subscriptionsCollection().doc(id).update({ ...input, updatedAt: Timestamp.now() });
}

export async function setMemberEmails(id: string, memberEmails: string[]): Promise<void> {
  await subscriptionsCollection().doc(id).update({ memberEmails, updatedAt: Timestamp.now() });
}

/** Flipped after a Secret Manager version lands, so the two can't claim a password that isn't there. */
export async function setHasPassword(id: string, hasPassword: boolean): Promise<void> {
  await subscriptionsCollection().doc(id).update({ hasPassword, updatedAt: Timestamp.now() });
}

/** A Firestore write batch caps at 500 operations. */
const BATCH_LIMIT = 500;

/**
 * Chunked because reveals accumulate without bound — one long-lived
 * subscription can pass the batch limit on its own.
 */
async function deleteEvery(collection: CollectionReference): Promise<void> {
  const snapshot = await collection.get();
  for (let i = 0; i < snapshot.docs.length; i += BATCH_LIMIT) {
    const batch = firestore.batch();
    snapshot.docs.slice(i, i + BATCH_LIMIT).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

export async function deleteSubscription(id: string): Promise<void> {
  // Firestore doesn't cascade: deleting the parent would orphan these
  // subcollections, leaving audit records addressable by a doc path nothing
  // lists anymore.
  await deleteEvery(revealsCollection(id));
  await deleteEvery(passwordsCollection(id));
  // Last, so a failure part-way through leaves the subscription (and its
  // remaining audit trail) reachable rather than orphaning the subcollection.
  await subscriptionsCollection().doc(id).delete();
}

export async function logReveal(
  subscriptionId: string,
  email: string,
  action: RevealAction,
  version: string | null = null,
): Promise<void> {
  await revealsCollection(subscriptionId).add({ email, action, version, at: Timestamp.now() });
}

export async function listReveals(subscriptionId: string, limit = 8): Promise<RevealDoc[]> {
  const snapshot = await revealsCollection(subscriptionId).orderBy("at", "desc").limit(limit).get();
  return snapshot.docs.map((doc) => toRevealDoc(doc.id, doc.data()));
}

/**
 * Records who saved a password and when, keyed by the Secret Manager version
 * the value landed as. `set` on that id rather than `add`, so a retried save
 * of the same version can't double up in the history.
 */
export async function logPasswordVersion(
  subscriptionId: string,
  version: string,
  setBy: string,
): Promise<void> {
  await passwordsCollection(subscriptionId)
    .doc(version)
    .set({ version, setBy, at: Timestamp.now() });
}

/**
 * Newest first. Ordered by `at` rather than by doc id, which is a numeric
 * string and would sort "10" before "9".
 */
export async function listPasswordVersions(
  subscriptionId: string,
  limit = 25,
): Promise<PasswordVersionDoc[]> {
  const snapshot = await passwordsCollection(subscriptionId)
    .orderBy("at", "desc")
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => toPasswordVersionDoc(doc.data()));
}
