import { FieldValue, Timestamp } from "@google-cloud/firestore";
import { firestore } from "../src/lib/firestore.js";

/**
 * One-off: moves every person's sideways links from the old `partnerIds`
 * field onto `connectionIds` (see PersonDoc). The app reads only the new
 * field and throws on a document that is missing it, rather than
 * defaulting — so this runs once per deployment, after shipping the code
 * that renamed it, and can then be deleted.
 *
 * Idempotent: a person already migrated has no `partnerIds` left to move.
 */
const snapshot = await firestore.collection("people").get();
let migrated = 0;

for (const doc of snapshot.docs) {
  const data = doc.data();
  const hasLegacy = Array.isArray(data.partnerIds);
  const hasCurrent = Array.isArray(data.connectionIds);
  if (!hasLegacy && hasCurrent) continue;

  // The union, not a straight copy: a person edited after the rename has
  // links on the new field that the old one never got.
  const connectionIds = Array.from(
    new Set<string>([
      ...(hasCurrent ? (data.connectionIds as string[]) : []),
      ...(hasLegacy ? (data.partnerIds as string[]) : []),
    ]),
  );

  await doc.ref.update({
    connectionIds,
    partnerIds: FieldValue.delete(),
    updatedAt: Timestamp.now(),
  });
  migrated += 1;
  console.log(`${data.name ?? doc.id}: ${connectionIds.length} connection(s)`);
}

console.log(`Migrated ${migrated} of ${snapshot.size} people.`);
