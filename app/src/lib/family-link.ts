import { normalizeEmail } from "./email.js";
import type { PersonDoc, UserRole } from "./types.js";

/**
 * Pure rules about who a person is and who may edit them. The
 * person/account join itself lives in lib/persona.ts (PersonaDirectory).
 */

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
