import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { requireFamilyMember, requireAdmin } from "../src/middleware/access-control.js";
import { usersRepo } from "../src/lib/users-repo.js";
import type { UserDoc } from "../src/lib/types.js";

function mockReqRes(email = "someone@example.com") {
  const req = { user: { email }, appUser: undefined } as unknown as Request;

  let statusCode = 200;
  let body: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    send(payload: unknown) {
      body = payload;
      return this;
    },
  } as unknown as Response;

  return {
    req,
    res,
    getStatus: () => statusCode,
    getBody: () => body,
  };
}

function makeUser(overrides: Partial<UserDoc> = {}): UserDoc {
  return {
    email: "someone@example.com",
    role: "member",
    createdAt: new Date(2026, 8, 1),
    updatedAt: new Date(2026, 8, 1),
    ...overrides,
  };
}

test("requireFamilyMember attaches the resolved user and calls next() when known", async (t) => {
  t.mock.method(usersRepo, "getUser", async () => makeUser());
  const { req, res, getStatus } = mockReqRes();
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };

  await requireFamilyMember(req, res, next);

  assert.equal(nextCalled, true);
  assert.equal(getStatus(), 200);
  assert.equal(req.appUser?.email, "someone@example.com");
});

test("requireFamilyMember blocks an unknown email with 403 and does not call next()", async (t) => {
  t.mock.method(usersRepo, "getUser", async () => null);
  const { req, res, getStatus } = mockReqRes();
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };

  await requireFamilyMember(req, res, next);

  assert.equal(nextCalled, false);
  assert.equal(getStatus(), 403);
});

test("requireAdmin calls next() for an admin", () => {
  const { req, res } = mockReqRes();
  req.appUser = makeUser({ role: "admin" });
  let nextCalled = false;
  requireAdmin(req, res, (() => {
    nextCalled = true;
  }) as NextFunction);

  assert.equal(nextCalled, true);
});

test("requireAdmin responds 403 for a non-admin", () => {
  const { req, res, getStatus } = mockReqRes();
  req.appUser = makeUser({ role: "member" });
  let nextCalled = false;
  requireAdmin(req, res, (() => {
    nextCalled = true;
  }) as NextFunction);

  assert.equal(nextCalled, false);
  assert.equal(getStatus(), 403);
});

test("requireAdmin responds 403 when appUser is missing", () => {
  const { req, res, getStatus } = mockReqRes();
  let nextCalled = false;
  requireAdmin(req, res, (() => {
    nextCalled = true;
  }) as NextFunction);

  assert.equal(nextCalled, false);
  assert.equal(getStatus(), 403);
});
