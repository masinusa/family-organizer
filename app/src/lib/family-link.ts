import { normalizeEmail } from "./email.js";
import type { PersonDoc, UserDoc, UserRole } from "./types.js";

/**
 * Pure — no Firestore — so the person/account join is unit-testable
 * without an emulator, same rationale as isLastAdmin in users-repo.ts.
 *
 * There is no link field between the two collections. A person's email
 * IS the join key: if it matches a `users` doc id, that person can sign
 * in. Nothing to keep in sync, and fixing a typo re-links them.
 */
export interface AccountMatch {
  accountByPersonId: Map<string, UserDoc>;
  /** Accounts with no person on the tree — otherwise unmanageable. */
  orphanAccounts: UserDoc[];
}

export function matchAccounts(people: PersonDoc[], users: UserDoc[]): AccountMatch {
  const userByEmail = new Map(users.map((u) => [normalizeEmail(u.email), u]));
  const accountByPersonId = new Map<string, UserDoc>();
  const claimed = new Set<string>();

  for (const person of people) {
    if (!person.email) continue;
    const key = normalizeEmail(person.email);
    const user = userByEmail.get(key);
    if (!user) continue;
    accountByPersonId.set(person.id, user);
    claimed.add(key);
  }

  const orphanAccounts = users.filter((u) => !claimed.has(normalizeEmail(u.email)));
  return { accountByPersonId, orphanAccounts };
}

/** The person whose email matches the signed-in viewer, if any. */
export function findPersonForEmail(people: PersonDoc[], email: string): PersonDoc | null {
  const key = normalizeEmail(email);
  return people.find((p) => p.email && normalizeEmail(p.email) === key) ?? null;
}

/**
 * Admins edit anyone; everyone else edits only their own card. Matching
 * is normalized on both sides, so "Ada@Example.com " still resolves to
 * the same person as "ada@example.com".
 */
export function canEditPersona(
  viewer: { email: string; role: UserRole },
  person: PersonDoc,
): boolean {
  if (viewer.role === "admin") return true;
  if (!person.email) return false;
  return normalizeEmail(person.email) === normalizeEmail(viewer.email);
}

/**
 * Nothing enforces email uniqueness across people, and a duplicate would
 * make two cards both claim to be "you". Used to warn, not to block.
 */
export function findDuplicateEmailOwner(
  people: PersonDoc[],
  email: string,
  exceptId: string,
): PersonDoc | null {
  const key = normalizeEmail(email);
  return people.find((p) => p.id !== exceptId && p.email && normalizeEmail(p.email) === key) ?? null;
}
