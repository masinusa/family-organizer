import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allowedFeatures,
  canOpenPath,
  canUseFeature,
  featureForPath,
  NO_PARTICIPATION,
  parseOptIns,
  type AccessContext,
} from "../src/lib/features.js";
import type { FeatureKey, UserRole } from "../src/lib/types.js";

function viewer(role: UserRole, optIns: FeatureKey[] = []) {
  return { role, optIns };
}

test("paths map to the feature that owns them", () => {
  assert.equal(featureForPath("/")?.key, "calendar");
  assert.equal(featureForPath("/events/abc/edit")?.key, "calendar");
  assert.equal(featureForPath("/family")?.key, "family");
  assert.equal(featureForPath("/family/p1")?.key, "family");
  assert.equal(featureForPath("/subscriptions/x/password/reveal")?.key, "vault");
  assert.equal(featureForPath("/feedback")?.key, "feedback");
});

test("a prefix owns only whole path segments", () => {
  assert.equal(featureForPath("/familyish"), null);
  assert.equal(featureForPath("/eventsfeed"), null);
});

test("the root owns only itself, not everything under it", () => {
  assert.equal(featureForPath("/friends"), null);
  assert.equal(featureForPath("/admin/feedback"), null);
});

test("family accounts open every feature", () => {
  for (const role of ["admin", "member"] as const) {
    assert.equal(allowedFeatures(viewer(role), NO_PARTICIPATION).length, 4);
    assert.equal(canOpenPath(viewer(role), "/subscriptions", NO_PARTICIPATION), true);
  }
});

test("a friend opens nothing until opted in", () => {
  const friend = viewer("friend");
  assert.deepEqual(allowedFeatures(friend, NO_PARTICIPATION), []);
  assert.equal(canOpenPath(friend, "/", NO_PARTICIPATION), false);
  assert.equal(canOpenPath(friend, "/family", NO_PARTICIPATION), false);
  assert.equal(canOpenPath(friend, "/feedback", NO_PARTICIPATION), false);
});

test("an opt-in opens exactly that feature", () => {
  const friend = viewer("friend", ["calendar"]);
  assert.equal(canOpenPath(friend, "/", NO_PARTICIPATION), true);
  assert.equal(canOpenPath(friend, "/events/new", NO_PARTICIPATION), true);
  assert.equal(canOpenPath(friend, "/family", NO_PARTICIPATION), false);
  assert.deepEqual(allowedFeatures(friend, NO_PARTICIPATION).map((f) => f.key), ["calendar"]);
});

test("taking part opens a feature without an opt-in", () => {
  const ctx: AccessContext = { participates: new Set<FeatureKey>(["family"]) };
  assert.equal(canUseFeature(viewer("friend"), "family", ctx), true);
  assert.equal(canUseFeature(viewer("friend"), "vault", ctx), false);
});

test("a path no feature claims is family only — the gate fails closed", () => {
  const everything = viewer("friend", ["calendar", "family", "vault", "feedback"]);
  assert.equal(canOpenPath(everything, "/friends", NO_PARTICIPATION), false);
  assert.equal(canOpenPath(everything, "/admin/feedback", NO_PARTICIPATION), false);
  assert.equal(canOpenPath(everything, "/some-page-added-later", NO_PARTICIPATION), false);
  assert.equal(canOpenPath(viewer("member"), "/some-page-added-later", NO_PARTICIPATION), true);
});

test("opt-ins parse from checkboxes and reject unknown keys", () => {
  assert.deepEqual(parseOptIns(undefined), []);
  assert.deepEqual(parseOptIns("vault"), ["vault"]);
  assert.deepEqual(parseOptIns(["vault", "calendar", "vault"]), ["vault", "calendar"]);
  assert.deepEqual(parseOptIns(["vault", "admin"]), { error: "Unknown feature." });
});
