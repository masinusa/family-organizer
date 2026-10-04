import { createUser } from "../src/lib/users-repo.js";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run seed:admin -- <email>");
  process.exit(1);
}

const { user, iapFailed } = await createUser(email, "admin");
console.log(`Admin ready: ${user.email} (role=${user.role})`);
if (iapFailed) {
  console.error("Warning: the Google IAP access grant failed — they may not be able to sign in.");
}
