import assert from "node:assert/strict";
import test from "node:test";
import {
  MAIL_FROM_MAX,
  NAME_MAX,
  NOTES_MAX,
  parseMemberEmails,
  parsePasswordVersion,
  parseSubscriptionInput,
} from "../src/lib/subscription-input.js";

test("parseSubscriptionInput accepts a name alone and nulls the rest", () => {
  assert.deepEqual(parseSubscriptionInput({ name: "  Netflix  " }), {
    name: "Netflix",
    accountEmail: null,
    accountPhone: null,
    link: null,
    notes: null,
    mailFrom: null,
  });
});

test("parseSubscriptionInput requires a name", () => {
  assert.deepEqual(parseSubscriptionInput({ accountEmail: "a@b.com" }), {
    error: "A name is required.",
  });
});

test("parseSubscriptionInput rejects a malformed request body", () => {
  assert.deepEqual(parseSubscriptionInput(null), { error: "A name is required." });
});

test("parseSubscriptionInput rejects an oversized name", () => {
  assert.deepEqual(parseSubscriptionInput({ name: "x".repeat(NAME_MAX + 1) }), {
    error: `A name must be ${NAME_MAX} characters or fewer.`,
  });
});

test("parseSubscriptionInput rejects oversized notes", () => {
  assert.deepEqual(parseSubscriptionInput({ name: "Netflix", notes: "x".repeat(NOTES_MAX + 1) }), {
    error: `Notes must be ${NOTES_MAX} characters or fewer.`,
  });
});

test("parseSubscriptionInput normalizes the account email so the mailbox match can't miss", () => {
  const parsed = parseSubscriptionInput({ name: "Netflix", accountEmail: "  Family@Example.COM " });
  assert.deepEqual(parsed, {
    name: "Netflix",
    accountEmail: "family@example.com",
    accountPhone: null,
    link: null,
    notes: null,
    mailFrom: null,
  });
});

test("parseSubscriptionInput prefixes a bare host with https", () => {
  const parsed = parseSubscriptionInput({ name: "Netflix", link: "netflix.com/login" });
  assert.equal("error" in parsed ? null : parsed.link, "https://netflix.com/login");
});

test("parseSubscriptionInput rejects a javascript: link", () => {
  assert.deepEqual(parseSubscriptionInput({ name: "Netflix", link: "javascript:alert(1)" }), {
    error: "Links must start with http:// or https://.",
  });
});

test("parseMemberEmails keeps only known members", () => {
  const body = { members: ["dad@example.com", "intruder@example.com"] };
  assert.deepEqual(parseMemberEmails(body, ["dad@example.com", "mum@example.com"]), [
    "dad@example.com",
  ]);
});

test("parseMemberEmails accepts a single ticked box as a bare string", () => {
  assert.deepEqual(parseMemberEmails({ members: "mum@example.com" }, ["dad@example.com", "mum@example.com"]), [
    "mum@example.com",
  ]);
});

test("parseMemberEmails normalizes both sides of the match", () => {
  assert.deepEqual(parseMemberEmails({ members: " DAD@example.com" }, ["Dad@Example.COM"]), [
    "dad@example.com",
  ]);
});

test("parseMemberEmails returns nothing when every box is unticked", () => {
  assert.deepEqual(parseMemberEmails({}, ["dad@example.com"]), []);
  assert.deepEqual(parseMemberEmails(null, ["dad@example.com"]), []);
});

test("parsePasswordVersion treats a missing version as the current password", () => {
  assert.deepEqual(parsePasswordVersion({}, ["2", "1"]), { version: null });
  assert.deepEqual(parsePasswordVersion({ version: "  " }, ["2", "1"]), { version: null });
});

test("parsePasswordVersion accepts a version this subscription recorded", () => {
  assert.deepEqual(parsePasswordVersion({ version: "1" }, ["2", "1"]), { version: "1" });
});

test("parsePasswordVersion rejects a version that isn't in the history", () => {
  // Nothing else stops a submitted version reaching a Secret Manager
  // resource path, so an unknown one must not get through.
  assert.deepEqual(parsePasswordVersion({ version: "9" }, ["2", "1"]), {
    error: "That password isn't in this subscription's history.",
  });
  assert.deepEqual(parsePasswordVersion({ version: "../../other/versions/1" }, ["1"]), {
    error: "That password isn't in this subscription's history.",
  });
  assert.deepEqual(parsePasswordVersion({ version: "latest" }, ["1"]), {
    error: "That password isn't in this subscription's history.",
  });
});

test("parseSubscriptionInput lowercases a mail sender, since matching ignores case", () => {
  const parsed = parseSubscriptionInput({ name: "Netflix", mailFrom: "  NETFLIX.com " });
  assert.equal("error" in parsed ? parsed.error : parsed.mailFrom, "netflix.com");
});

test("parseSubscriptionInput accepts a full address as a mail sender", () => {
  const parsed = parseSubscriptionInput({ name: "Netflix", mailFrom: "info@netflix.com" });
  assert.equal("error" in parsed ? parsed.error : parsed.mailFrom, "info@netflix.com");
});

/**
 * The value is compiled into an IMAP SEARCH command, so the characters that
 * could end or extend that command are rejected outright rather than
 * escaped — a space is enough to make it not an address or domain.
 */
test("parseSubscriptionInput rejects a mail sender that isn't an address or domain", () => {
  for (const mailFrom of [
    'netflix.com" OR FROM "',
    "netflix.com\r\nSEARCH ALL",
    "Netflix Billing",
    "net flix.com",
    "*",
  ]) {
    const parsed = parseSubscriptionInput({ name: "Netflix", mailFrom });
    assert.ok("error" in parsed, `accepted ${JSON.stringify(mailFrom)}`);
    assert.match(parsed.error, /address or a domain/);
  }
});

test("parseSubscriptionInput rejects an over-long mail sender", () => {
  const parsed = parseSubscriptionInput({
    name: "Netflix",
    mailFrom: `${"n".repeat(MAIL_FROM_MAX)}.com`,
  });
  assert.ok("error" in parsed);
  assert.match(parsed.error, new RegExp(String(MAIL_FROM_MAX)));
});
