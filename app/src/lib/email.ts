/**
 * The one definition of how an email is keyed. `users` doc ids are
 * normalized this way, so anything compared against them — including
 * PersonDoc.email, which is how a tree card is matched to an account —
 * has to be normalized identically or the join silently misses on
 * casing or stray whitespace.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
