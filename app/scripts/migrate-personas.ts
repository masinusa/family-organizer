import { normalizeEmail } from "../src/lib/email.js";
import { peopleRepo } from "../src/lib/people-repo.js";
import { usersRepo } from "../src/lib/users-repo.js";

/**
 * One-off: gives every account somebody on the tree. The app now requires
 * that (PersonaDirectory in src/lib/persona.ts throws on an account with no
 * matching person) instead of drawing an orphan account as a bare email,
 * so this runs once per deployment, after shipping that change, and can
 * then be deleted.
 *
 * Each new person is named after their email's local part — a placeholder
 * an admin should rename from their card. Idempotent: an account that
 * already has a person is skipped.
 */
const [people, users] = await Promise.all([peopleRepo.listPeople(), usersRepo.listUsers()]);
const claimed = new Set(people.filter((p) => p.email).map((p) => normalizeEmail(p.email!)));
let created = 0;

for (const user of users) {
  if (claimed.has(normalizeEmail(user.email))) continue;
  const name = user.email.split("@")[0]!;
  const person = await peopleRepo.createPerson(name, user.email, "family");
  created += 1;
  console.log(`${user.email}: created "${name}" (/family/${person.id}) — rename them there.`);
}

console.log(`Created ${created} person(s) for ${users.length} account(s).`);
