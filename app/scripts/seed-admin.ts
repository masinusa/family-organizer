import { normalizeEmail } from "../src/lib/email.js";
import { peopleRepo } from "../src/lib/people-repo.js";
import { createUser } from "../src/lib/users-repo.js";

/**
 * Every account belongs to somebody on the tree, so the first admin needs
 * a person too. Re-runnable: an existing person with this email is reused
 * (and keeps their name), and createUser is already idempotent.
 */
const email = process.argv[2];
const name = process.argv[3]?.trim();
if (!email || !name) {
  console.error('Usage: npm run seed:admin -- <email> "<name>"');
  process.exit(1);
}

const people = await peopleRepo.listPeople();
const existing = people.find((p) => p.email && normalizeEmail(p.email) === normalizeEmail(email));
const person = existing ?? (await peopleRepo.createPerson(name, email, "family"));

const { user, iapFailed } = await createUser(email, "admin");
console.log(`Admin ready: ${person.name} <${user.email}> (role=${user.role})`);
if (iapFailed) {
  console.error("Warning: the Google IAP access grant failed — they may not be able to sign in.");
}
