import assert from "node:assert/strict";
import test from "node:test";
import {
  decodePayload,
  encodePayload,
  LATEST_VERSION,
  secretStore,
  subscriptionSecretId,
  usingRealSecretManager,
} from "../src/lib/secret-store.js";

test("subscriptionSecretId derives a valid Secret Manager id from a Firestore doc id", () => {
  const id = subscriptionSecretId("aBc123XyZ456aBc123Xy");
  assert.equal(id, "sub-aBc123XyZ456aBc123Xy");
  // Secret Manager accepts [a-zA-Z0-9_-]{1,255}.
  assert.match(id, /^[a-zA-Z0-9_-]{1,255}$/);
});

test("the payload codec round-trips a password with punctuation and non-ASCII", () => {
  const password = "pâs$w:rd/with+odd=chars 🙂";
  assert.equal(decodePayload(encodePayload(password)), password);
});

test("encodePayload produces base64, which is what the REST API carries", () => {
  assert.equal(encodePayload("hunter2"), Buffer.from("hunter2", "utf8").toString("base64"));
});

/**
 * config.ts reads the environment once at import, so this asserts the
 * behaviour under the test runner's own environment — which has no project
 * id set, exactly like the emulator path in scripts/dev-local.sh.
 */
test("the in-memory backend is selected when no GCP project is configured", () => {
  assert.equal(usingRealSecretManager(), false);
});

/**
 * Which means setSecret/getSecretVersion below exercise the in-memory
 * backend — the same one scripts/dev-local.sh runs on. Each test uses its
 * own secret id, since that store is per-process and shared.
 */
test("setSecret keeps every value and numbers the versions from 1", async () => {
  assert.equal(await secretStore.setSecret("sub-versions", "first"), "1");
  assert.equal(await secretStore.setSecret("sub-versions", "second"), "2");
  assert.equal(await secretStore.setSecret("sub-versions", "third"), "3");
});

test("getSecret returns the newest value, and getSecretVersion the one asked for", async () => {
  await secretStore.setSecret("sub-history", "old");
  await secretStore.setSecret("sub-history", "new");

  assert.equal(await secretStore.getSecret("sub-history"), "new");
  assert.equal(await secretStore.getSecretVersion("sub-history", "1"), "old");
  assert.equal(await secretStore.getSecretVersion("sub-history", "2"), "new");
  assert.equal(await secretStore.getSecretVersion("sub-history", LATEST_VERSION), "new");
});

test("getSecretVersion is null for a version or secret that was never stored", async () => {
  await secretStore.setSecret("sub-gaps", "only");
  assert.equal(await secretStore.getSecretVersion("sub-gaps", "2"), null);
  assert.equal(await secretStore.getSecretVersion("sub-gaps", "nonsense"), null);
  assert.equal(await secretStore.getSecretVersion("sub-never-stored"), null);
});

test("deleteSecret takes the history with it", async () => {
  await secretStore.setSecret("sub-doomed", "first");
  await secretStore.setSecret("sub-doomed", "second");
  await secretStore.deleteSecret("sub-doomed");

  assert.equal(await secretStore.getSecret("sub-doomed"), null);
  assert.equal(await secretStore.getSecretVersion("sub-doomed", "1"), null);
  // And a later save starts numbering over, rather than resuming at 3.
  assert.equal(await secretStore.setSecret("sub-doomed", "third"), "1");
});
