import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { iapAuth, oAuth2Client } from "../src/middleware/iap-auth.js";

function mockReqRes(headers: Record<string, string> = {}) {
  const req = {
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;

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

test("rejects a request with no IAP assertion and no dev bypass", async () => {
  const { req, res, getStatus } = mockReqRes();
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };

  await iapAuth(req, res, next);

  assert.equal(nextCalled, false);
  assert.equal(getStatus(), 401);
});

test("rejects a malformed IAP assertion without making a real network call", async (t) => {
  // Stub the public-key fetch so this stays hermetic — signature
  // verification of a garbage token fails regardless of what the "keys"
  // contain, so the exact stub value doesn't matter here.
  t.mock.method(oAuth2Client, "getIapPublicKeys", async () => ({
    pubkeys: {},
  }));

  const { req, res, getStatus } = mockReqRes({
    "x-goog-iap-jwt-assertion": "not-a-real-jwt",
  });
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };

  await iapAuth(req, res, next);

  assert.equal(nextCalled, false);
  assert.equal(getStatus(), 401);
  mock.reset();
});
