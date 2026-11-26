import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import {
  IMPERSONATION_COOKIE,
  applyImpersonation,
  realAdmin,
  realEmail,
  impersonationState,
} from "../src/middleware/impersonation.js";
import { safeReturnPath } from "../src/routes/impersonate.js";
import { usersRepo } from "../src/lib/users-repo.js";
import type { UserDoc, UserRole } from "../src/lib/types.js";

function makeUser(email: string, role: UserRole): UserDoc {
  return { email, role, optIns: [], createdAt: new Date(2026, 8, 1), updatedAt: new Date(2026, 8, 1) };
}

/** `cookie` is the raw header, so a malformed one can be exercised too. */
function mockReqRes(email: string, cookie?: string) {
  const req = {
    user: { email },
    method: "GET",
    originalUrl: "/family",
    headers: cookie === undefined ? {} : { cookie },
  } as unknown as Request;

  const cleared: string[] = [];
  const set: Array<{ name: string; value: string }> = [];
  const res = {
    cookie(name: string, value: string) {
      set.push({ name, value });
      return this;
    },
    clearCookie(name: string) {
      cleared.push(name);
      return this;
    },
  } as unknown as Response;

  return { req, res, cleared, set };
}

function spyNext(): NextFunction & { called: () => boolean } {
  let called = false;
  const next = (() => {
    called = true;
  }) as NextFunction & { called: () => boolean };
  next.called = () => called;
  return next;
}

test("no cookie leaves the IAP identity alone and reads nothing", async (t) => {
  let reads = 0;
  t.mock.method(usersRepo, "getUser", async () => {
    reads++;
    return null;
  });

  const { req, res } = mockReqRes("admin@example.com");
  const next = spyNext();
  await applyImpersonation(req, res, next);

  assert.equal(next.called(), true);
  assert.equal(req.user!.email, "admin@example.com");
  assert.equal(req.impersonator, undefined);
  assert.equal(reads, 0, "the common request shouldn't pay for this feature");
});

test("an admin's cookie replaces req.user with the impersonated identity", async (t) => {
  t.mock.method(usersRepo, "getUser", async () => makeUser("admin@example.com", "admin"));

  const { req, res } = mockReqRes("admin@example.com", `${IMPERSONATION_COOKIE}=kid%40example.com`);
  const next = spyNext();
  await applyImpersonation(req, res, next);

  assert.equal(next.called(), true);
  assert.equal(req.user!.email, "kid@example.com");
  assert.equal(req.impersonator?.email, "admin@example.com");
});

test("a non-admin's cookie is ignored and dropped", async (t) => {
  t.mock.method(usersRepo, "getUser", async () => makeUser("member@example.com", "member"));

  const { req, res, cleared } = mockReqRes(
    "member@example.com",
    `${IMPERSONATION_COOKIE}=admin%40example.com`,
  );
  const next = spyNext();
  await applyImpersonation(req, res, next);

  assert.equal(next.called(), true);
  assert.equal(req.user!.email, "member@example.com");
  assert.equal(req.impersonator, undefined);
  assert.deepEqual(cleared, [IMPERSONATION_COOKIE]);
});

test("a cookie from an email with no account at all is ignored and dropped", async (t) => {
  t.mock.method(usersRepo, "getUser", async () => null);

  const { req, res, cleared } = mockReqRes(
    "stranger@example.com",
    `${IMPERSONATION_COOKIE}=admin%40example.com`,
  );
  const next = spyNext();
  await applyImpersonation(req, res, next);

  assert.equal(req.impersonator, undefined);
  assert.deepEqual(cleared, [IMPERSONATION_COOKIE]);
});

test("a cookie pointing at yourself is dropped rather than carried as a no-op", async (t) => {
  t.mock.method(usersRepo, "getUser", async () => makeUser("admin@example.com", "admin"));

  const { req, res, cleared } = mockReqRes(
    "admin@example.com",
    `${IMPERSONATION_COOKIE}=Admin%40Example.com`,
  );
  await applyImpersonation(req, res, spyNext());

  assert.equal(req.impersonator, undefined);
  assert.deepEqual(cleared, [IMPERSONATION_COOKIE]);
});

test("the cookie is found alongside others and however it's spaced", async (t) => {
  t.mock.method(usersRepo, "getUser", async () => makeUser("admin@example.com", "admin"));

  const { req, res } = mockReqRes(
    "admin@example.com",
    `other=1; ${IMPERSONATION_COOKIE}=kid%40example.com ;trailing=2`,
  );
  await applyImpersonation(req, res, spyNext());

  assert.equal(req.user!.email, "kid@example.com");
});

test("realAdmin follows the signed-in account, not the impersonated one", async (t) => {
  let reads = 0;
  t.mock.method(usersRepo, "getUser", async () => {
    reads++;
    return makeUser("kid@example.com", "member");
  });

  const { req } = mockReqRes("kid@example.com");
  req.impersonator = makeUser("admin@example.com", "admin");

  assert.equal((await realAdmin(req))?.email, "admin@example.com");
  assert.equal(realEmail(req), "admin@example.com");
  assert.equal(reads, 0, "the admin doc is already in hand while impersonating");
});

test("realAdmin refuses a member who isn't impersonating", async (t) => {
  t.mock.method(usersRepo, "getUser", async () => makeUser("member@example.com", "member"));

  const { req } = mockReqRes("member@example.com");
  assert.equal(await realAdmin(req), null);
  assert.equal(realEmail(req), "member@example.com");
});

test("impersonationState only offers a return path on a GET", () => {
  const { req } = mockReqRes("admin@example.com");
  assert.deepEqual(impersonationState(req), { impersonator: null, path: "/family" });

  (req as { method: string }).method = "POST";
  assert.equal(impersonationState(req).path, "/");
});

test("safeReturnPath keeps a same-site path and its query", () => {
  assert.equal(safeReturnPath("/family/abc123"), "/family/abc123");
  assert.equal(safeReturnPath("/?year=2026&month=3"), "/?year=2026&month=3");
  assert.equal(safeReturnPath("/"), "/");
});

test("safeReturnPath refuses anything that could leave the site", () => {
  for (const raw of [
    "//evil.example.com",
    "/\\evil.example.com",
    "https://evil.example.com/",
    "javascript:alert(1)",
    "family",
    "",
    undefined,
    42,
  ]) {
    assert.equal(safeReturnPath(raw), "/", `should have refused ${String(raw)}`);
  }
});

test("safeReturnPath drops a fragment rather than echoing it back", () => {
  assert.equal(safeReturnPath("/family#anything"), "/family");
});
