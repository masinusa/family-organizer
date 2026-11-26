import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { requireFeatureAccess } from "../src/middleware/feature-access.js";
import type { FeatureKey, UserDoc, UserRole } from "../src/lib/types.js";

function makeUser(role: UserRole, optIns: FeatureKey[] = []): UserDoc {
  return { email: "someone@example.com", role, optIns, createdAt: new Date(2026, 8, 1), updatedAt: new Date(2026, 8, 1) };
}

async function run(user: UserDoc, path: string, method = "GET") {
  const req = { appUser: user, path, method, originalUrl: path } as unknown as Request;
  let status = 200;
  let redirect: string | null = null;
  let body: unknown = null;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    send(payload: unknown) {
      body = payload;
      return this;
    },
    redirect(to: string) {
      redirect = to;
      return this;
    },
  } as unknown as Response;
  let nextCalled = false;
  await requireFeatureAccess(req, res, (err?: unknown) => {
    if (err) throw err;
    nextCalled = true;
  });
  return { req, status, redirect, body, nextCalled };
}

test("family pass straight through and see every feature", async () => {
  const result = await run(makeUser("member"), "/subscriptions");
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.features!.length, 4);
});

test("a friend is refused a feature they aren't in", async () => {
  const result = await run(makeUser("friend", ["calendar"]), "/family");
  assert.equal(result.nextCalled, false);
  assert.equal(result.status, 403);
  assert.match(String(result.body), /This part of the site isn&#39;t shared with you/);
});

test("a friend opted in passes", async () => {
  const result = await run(makeUser("friend", ["family"]), "/family/p1");
  assert.equal(result.nextCalled, true);
  assert.deepEqual(result.req.features!.map((f) => f.key), ["family"]);
});

test("a friend without the calendar is sent from / to what they can open", async () => {
  const result = await run(makeUser("friend", ["vault"]), "/");
  assert.equal(result.nextCalled, false);
  assert.equal(result.redirect, "/subscriptions");
});

test("a friend with nothing shared gets a 403 at /, not a redirect loop", async () => {
  const result = await run(makeUser("friend"), "/");
  assert.equal(result.redirect, null);
  assert.equal(result.status, 403);
  assert.match(String(result.body), /Nothing here has been shared/);
});

test("a POST to / is refused rather than redirected", async () => {
  const result = await run(makeUser("friend", ["vault"]), "/", "POST");
  assert.equal(result.redirect, null);
  assert.equal(result.status, 403);
});
