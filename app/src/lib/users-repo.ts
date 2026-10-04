import { FieldPath, Timestamp, type DocumentData } from "@google-cloud/firestore";
import { firestore } from "./firestore.js";
import { normalizeEmail } from "./email.js";
import * as iapAccess from "./iap-access.js";
import type { UserDoc, UserRole } from "./types.js";

const usersCollection = () => firestore.collection("users");

/**
 * Shown when Firestore saved but the Google IAM write didn't. The two can
 * disagree, and silently reporting success would strand someone who looks
 * added but cannot actually sign in.
 */
export const IAP_SYNC_WARNING =
  "Saved, but the Google access change didn't go through — sign-in may not work yet. Try again in a moment.";

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
 * self-provisioning. Passing IAP only proves Google let them to the door;
 * an admin must still explicitly add them here before they can use the
 * app at all.
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
 *
 * Also grants IAP access for the email — the Firestore doc used to be
 * necessary-but-not-sufficient (they still needed adding to a separate
 * Google Group by hand); now this one call is the whole grant. A failure
 * to reach IAP is reported back via `iapFailed` rather than thrown: the
 * Firestore doc is the access record that matters to the rest of the app
 * and must not roll back over a secondary IAM hiccup, but the caller
 * still has to be able to say so instead of claiming success.
 */
export async function createUser(
  email: string,
  role: UserRole,
): Promise<{ user: UserDoc; iapFailed: boolean }> {
  const id = normalizeEmail(email);
  const ref = usersCollection().doc(id);
  const existing = await ref.get();
  const now = Timestamp.now();

  let user: UserDoc;
  if (!existing.exists) {
    await ref.set({ role, createdAt: now, updatedAt: now });
    user = toUserDoc(id, { role, createdAt: now, updatedAt: now });
  } else {
    await ref.update({ role, updatedAt: now });
    const data = existing.data()!;
    user = toUserDoc(id, { ...data, role, updatedAt: now });
  }

  let iapFailed = false;
  try {
    await iapAccess.grantAccess(id);
  } catch (err) {
    iapFailed = true;
    console.error(`Failed to grant IAP access to ${id}:`, err);
  }
  return { user, iapFailed };
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

/**
 * Real delete — access is revoked immediately, not soft-flagged. Also
 * revokes IAP access; a failure there is reported via `iapFailed` rather
 * than thrown, since the Firestore delete is the revocation that matters
 * even if the secondary IAM write hiccups (see requireFamilyMember in
 * access-control.ts). Worth surfacing: a stranded IAM grant means they
 * can still reach the door, even though the app will refuse them.
 */
export async function deleteUser(email: string): Promise<{ iapFailed: boolean }> {
  const id = normalizeEmail(email);
  await assertNotLastAdmin(id);
  await usersCollection().doc(id).delete();
  try {
    await iapAccess.revokeAccess(id);
  } catch (err) {
    console.error(`Failed to revoke IAP access for ${id}:`, err);
    return { iapFailed: true };
  }
  return { iapFailed: false };
}

/**
 * Object form of the functions above, exported so callers that need to
 * stub a method in tests can (ES module named exports are frozen
 * bindings — t.mock.method can't redefine them directly, same reason
 * iap-auth.ts exports oAuth2Client as an object rather than bare
 * functions).
 */
export const usersRepo = { getUser, listUsers, createUser, setRole, deleteUser };
