import { Timestamp } from "@google-cloud/firestore";
import { firestore } from "../src/lib/firestore.js";

/**
 * One-off: friends arrived, so every person now says which circle they're
 * in and every account which features it's been opted into. The app reads
 * both fields and throws on a document missing either, rather than
 * defaulting — so this runs once per deployment, after shipping that
 * change, and can then be deleted.
 *
 * Everybody who existed before friends is family, with no opt-ins (family
 * get every feature anyway). Raw Firestore, not the repos: they would throw
 * on exactly the documents this exists to fix.
 *
 * Idempotent: a document that already has the field is left alone.
 */
const now = Timestamp.now();

const people = await firestore.collection("people").get();
let peopleMigrated = 0;
for (const doc of people.docs) {
  if (doc.data().circle !== undefined) continue;
  await doc.ref.update({ circle: "family", updatedAt: now });
  peopleMigrated += 1;
}

const users = await firestore.collection("users").get();
let usersMigrated = 0;
for (const doc of users.docs) {
  if (doc.data().optIns !== undefined) continue;
  await doc.ref.update({ optIns: [], updatedAt: now });
  usersMigrated += 1;
}

console.log(`Marked ${peopleMigrated} of ${people.size} people as family.`);
console.log(`Gave ${usersMigrated} of ${users.size} accounts empty opt-ins.`);
