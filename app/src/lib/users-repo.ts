import { FieldPath, Timestamp, type DocumentData } from "@google-cloud/firestore";
import { firestore } from "./firestore.js";
import type { UserDoc, UserRole } from "./types.js";

const usersCollection = () => firestore.collection("users");

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toUserDoc(id: string, data: DocumentData): UserDoc {
  return {
    email: id,
    role: data.role,
    createdAt: (data.createdAt as Timestamp).toDate(),
    updatedAt: (data.updatedAt as Timestamp).toDate(),
  };
}

/**
 * The presence of a doc is what grants app access — there's no
 * self-provisioning. Passing IAP only proves someone's in the family
 * Google Group; an admin must still explicitly add them here before
 * they can use the app at all.
 */
export async function getUser(email: string): Promise<UserDoc | null> {
  const snap = await usersCollection().doc(normalizeEmail(email)).get();
  return snap.exists ? toUserDoc(snap.id, snap.data()!) : null;
}

export async function listUsers(): Promise<UserDoc[]> {
  // email isn't a stored field (the doc id already is the email), so order
  // by document id rather than a field name Firestore would find missing.
  const snapshot = await usersCollection().orderBy(FieldPath.documentId()).get();
  return snapshot.docs.map((doc) => toUserDoc(doc.id, doc.data()));
}

/**
 * Adds a family member ahead of their first login, or re-roles one who
 * already exists. Idempotent by design: this is what makes it safe to use
 * both as the admin "add a family member" action and as a re-runnable
 * bootstrap/recovery script (see scripts/seed-admin.ts).
 */
export async function createUser(email: string, role: UserRole): Promise<UserDoc> {
  const id = normalizeEmail(email);
  const ref = usersCollection().doc(id);
  const existing = await ref.get();
  const now = Timestamp.now();

  if (!existing.exists) {
    await ref.set({ role, createdAt: now, updatedAt: now });
    return toUserDoc(id, { role, createdAt: now, updatedAt: now });
  }

  await ref.update({ role, updatedAt: now });
  const data = existing.data()!;
  return toUserDoc(id, { ...data, role, updatedAt: now });
}

/** Pure — no Firestore access — so it's unit-testable without an emulator. */
export function isLastAdmin(users: UserDoc[], email: string): boolean {
  const admins = users.filter((u) => u.role === "admin");
  const target = normalizeEmail(email);
  return admins.length === 1 && admins[0]!.email === target;
}

export const LAST_ADMIN_ERROR = "Cannot remove the last remaining admin.";

async function assertNotLastAdmin(email: string): Promise<void> {
  const snapshot = await usersCollection().where("role", "==", "admin").get();
  const admins = snapshot.docs.map((doc) => toUserDoc(doc.id, doc.data()));
  if (isLastAdmin(admins, email)) {
    throw new Error(LAST_ADMIN_ERROR);
  }
}

export async function setRole(email: string, role: UserRole): Promise<void> {
  const id = normalizeEmail(email);
  if (role === "member") {
    await assertNotLastAdmin(id);
  }
  await usersCollection().doc(id).update({ role, updatedAt: Timestamp.now() });
}

/** Real delete — access is revoked immediately, not soft-flagged. */
export async function deleteUser(email: string): Promise<void> {
  const id = normalizeEmail(email);
  await assertNotLastAdmin(id);
  await usersCollection().doc(id).delete();
}

/**
 * Object form of the functions above, exported so callers that need to
 * stub a method in tests can (ES module named exports are frozen
 * bindings — t.mock.method can't redefine them directly, same reason
 * iap-auth.ts exports oAuth2Client as an object rather than bare
 * functions).
 */
export const usersRepo = { getUser, listUsers, createUser, setRole, deleteUser };
