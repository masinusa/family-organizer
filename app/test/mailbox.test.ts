import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyOf,
  formatAgo,
  toBodyParts,
  toServiceMessages,
  WINDOW_DAYS,
  type RawMessage,
} from "../src/lib/mailbox.js";

const SENDER = "netflix.com";

const NOW = new Date(2026, 9, 15, 12, 0, 0);

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function recent(raw: RawMessage[]): ReturnType<typeof toServiceMessages> {
  return toServiceMessages(raw, SENDER, NOW);
}

function makeRaw(overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    from: "Netflix <info@netflix.com>",
    subject: "Your sign-in code",
    date: minutesAgo(2),
    text: "Your code is 481902 and expires shortly.",
    ...overrides,
  };
}

test("toServiceMessages keeps a message inside the window", () => {
  const messages = recent([makeRaw()]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.subject, "Your sign-in code");
  assert.equal(messages[0]!.from, "Netflix <info@netflix.com>");
  assert.equal(messages[0]!.ago, "2m ago");
});

test("toServiceMessages drops a message older than the window", () => {
  const raw = [makeRaw({ date: daysAgo(WINDOW_DAYS + 1) })];
  assert.deepEqual(recent(raw), []);
});

test("toServiceMessages keeps a message exactly on the window boundary", () => {
  const raw = [makeRaw({ date: daysAgo(WINDOW_DAYS) })];
  assert.equal(recent(raw).length, 1);
});

/**
 * The IMAP search already filtered on both, but SINCE ignores the time of
 * day and a sender match is now the whole privacy boundary — so the pure
 * mapper re-applies them rather than trusting the server's interpretation.
 */
test("toServiceMessages drops a message from any other sender", () => {
  const raw = [
    makeRaw({ from: "Spotify <no-reply@spotify.com>", subject: "unrelated" }),
    makeRaw({ from: "Dentist <hello@dentist.example>", subject: "also unrelated" }),
    makeRaw({ subject: "kept" }),
  ];
  assert.deepEqual(
    recent(raw).map((message) => message.subject),
    ["kept"],
  );
});

test("toServiceMessages matches the sender regardless of casing", () => {
  const raw = [makeRaw({ from: "Netflix <INFO@NETFLIX.COM>" })];
  assert.equal(recent(raw).length, 1);
});

test("toServiceMessages matches a bare domain anywhere in the From header", () => {
  const raw = [makeRaw({ from: "\"Netflix Billing\" <billing.notice@mailer.netflix.com>" })];
  assert.equal(recent(raw).length, 1);
});

test("toServiceMessages drops a message with no sender rather than guessing", () => {
  assert.deepEqual(recent([makeRaw({ from: null })]), []);
});

test("toServiceMessages caps how many messages one search can render", () => {
  const raw = Array.from({ length: 30 }, (_unused, index) =>
    makeRaw({ subject: `mail ${index}`, date: minutesAgo(index + 1) }),
  );
  assert.equal(recent(raw).length, 20);
  // The cap takes the newest, not the first 20 the server happened to return.
  assert.equal(recent(raw)[0]!.subject, "mail 0");
});

test("toServiceMessages drops a message with no date rather than guessing", () => {
  assert.deepEqual(recent([makeRaw({ date: null })]), []);
});

test("toServiceMessages returns newest first", () => {
  const raw = [
    makeRaw({ subject: "older", date: minutesAgo(9) }),
    makeRaw({ subject: "newest", date: minutesAgo(1) }),
    makeRaw({ subject: "middle", date: minutesAgo(5) }),
  ];
  assert.deepEqual(
    recent(raw).map((message) => message.subject),
    ["newest", "middle", "older"],
  );
});

test("toServiceMessages keeps the body's line breaks, which are its only structure", () => {
  const raw = [makeRaw({ text: "Your code is\n\n481902\n\nThe Netflix team" })];
  assert.deepEqual(recent(raw)[0]!.parts, [{ text: "Your code is\n\n481902\n\nThe Netflix team" }]);
});

test("toServiceMessages hands the view a link as a part, not as text", () => {
  const raw = [makeRaw({ text: "Verify now: https://netflix.com/verifyemail?g=abc" })];
  assert.deepEqual(recent(raw)[0]!.parts, [
    { text: "Verify now: " },
    { href: "https://netflix.com/verifyemail?g=abc", label: "netflix.com/verifyemail" },
  ]);
});

test("toServiceMessages degrades gracefully with no body or subject", () => {
  // The From header has to stay: it is what the sender filter matches on.
  const raw = [makeRaw({ text: null, subject: null })];
  assert.deepEqual(recent(raw), [
    {
      from: "Netflix <info@netflix.com>",
      subject: "(no subject)",
      parts: [],
      bodyTrimmed: false,
      ago: "2m ago",
    },
  ]);
});

test("bodyOf normalizes CRLF, which is what the wire format uses", () => {
  assert.equal(bodyOf("line one\r\nline two").body, "line one\nline two");
});

test("bodyOf squeezes the blank-line padding these generators emit", () => {
  assert.equal(bodyOf("one\n\n\n\n\ntwo").body, "one\n\ntwo");
});

test("bodyOf trims surrounding whitespace", () => {
  assert.equal(bodyOf("\n\n  Your code is 481902.  \n\n").body, "Your code is 481902.");
});

test("bodyOf reports nothing trimmed for an ordinary message", () => {
  assert.deepEqual(bodyOf("short"), { body: "short", bodyTrimmed: false });
});

test("bodyOf caps a body that would fill the page, and says it did", () => {
  const result = bodyOf("x".repeat(12000));
  assert.equal(result.body.length, 10000);
  assert.equal(result.bodyTrimmed, true);
});

test("bodyOf treats a missing body as empty rather than throwing", () => {
  assert.deepEqual(bodyOf(null), { body: "", bodyTrimmed: false });
});

test("toBodyParts leaves a body with no link as one run of text", () => {
  assert.deepEqual(toBodyParts("Nothing to click here."), [{ text: "Nothing to click here." }]);
});

test("toBodyParts returns nothing for an empty body", () => {
  assert.deepEqual(toBodyParts(""), []);
});

test("toBodyParts labels a link with host and path, dropping the tracking query", () => {
  const long = `https://www.netflix.com/verifyemail?g=${"x".repeat(400)}`;
  const parts = toBodyParts(long);
  assert.deepEqual(parts, [{ href: long, label: "www.netflix.com/verifyemail" }]);
});

test("toBodyParts truncates a label that is itself too long, keeping the host first", () => {
  const parts = toBodyParts(`https://netflix.com/${"a".repeat(80)}`);
  const part = parts[0]!;
  assert.ok("label" in part);
  assert.ok(part.label.startsWith("netflix.com/aaa"));
  assert.ok(part.label.endsWith("…"));
  assert.equal(part.label.length, 61);
});

test("toBodyParts gives a bare host no trailing slash in the label", () => {
  assert.deepEqual(toBodyParts("https://netflix.com/"), [
    { href: "https://netflix.com/", label: "netflix.com" },
  ]);
});

test("toBodyParts pushes sentence punctuation back into the text", () => {
  assert.deepEqual(toBodyParts("Go to https://netflix.com/login."), [
    { text: "Go to " },
    { href: "https://netflix.com/login", label: "netflix.com/login" },
    { text: "." },
  ]);
});

test("toBodyParts leaves a closing bracket it never opened out of the link", () => {
  assert.deepEqual(toBodyParts("(see https://netflix.com/help)"), [
    { text: "(see " },
    { href: "https://netflix.com/help", label: "netflix.com/help" },
    { text: ")" },
  ]);
});

test("toBodyParts keeps a parenthesis the URL itself opened", () => {
  const url = "https://example.test/a_(b)";
  assert.deepEqual(toBodyParts(url), [{ href: url, label: "example.test/a_(b)" }]);
});

test("toBodyParts handles several links in one line", () => {
  assert.deepEqual(toBodyParts("a https://x.test/1 b https://y.test/2 c"), [
    { text: "a " },
    { href: "https://x.test/1", label: "x.test/1" },
    { text: " b " },
    { href: "https://y.test/2", label: "y.test/2" },
    { text: " c" },
  ]);
});

test("toBodyParts never links a javascript: or data: URL", () => {
  // The pattern only matches http(s), so these stay inert text — the same
  // rule parseLink applies to the event form's link field.
  assert.deepEqual(toBodyParts("javascript:alert(1) and data:text/html,<b>"), [
    { text: "javascript:alert(1) and data:text/html,<b>" },
  ]);
});

test("toBodyParts matches a link written in capitals", () => {
  // Case-sensitive at first, so "HTTP://..." rendered as dead text.
  assert.deepEqual(toBodyParts("See HTTPS://NETFLIX.COM/Verify now"), [
    { text: "See " },
    { href: "https://netflix.com/Verify", label: "netflix.com/Verify" },
    { text: " now" },
  ]);
});

test("toBodyParts punycodes a non-ASCII host rather than showing its own script", () => {
  // Deliberate: a lookalike domain in Cyrillic reads as the real thing, so
  // both href and label carry the punycode form URL produces.
  const parts = toBodyParts("https://нетфликс.рф/тест");
  const part = parts[0]!;
  assert.ok("href" in part);
  assert.ok(part.href.startsWith("https://xn--e1aggci2adq.xn--p1ai/"));
  assert.ok(part.label.startsWith("xn--e1aggci2adq.xn--p1ai/"));
});

test("toBodyParts loses no character of the body outside the links themselves", () => {
  // The guarantee that makes this safe to put in front of a reader: the
  // parts, concatenated, are the body. A splitter that drops or duplicates
  // text would silently rewrite somebody's email. Links are compared by
  // href, which for an ASCII URL is what the email wrote; the punycode case
  // above is the one place that normalizes.
  const body = [
    "Hi there,",
    "",
    "Verify: https://www.netflix.com/verifyemail?g=64faee0e-a899-4d03&lkid=URL",
    "Questions? Call 1-844-569-7700 or see https://help.netflix.com/help?g=4cd4.",
    "(terms: https://www.netflix.com/TermsOfUse), privacy: https://netflix.com/p",
  ].join("\n");
  const rebuilt = toBodyParts(body)
    .map((part) => ("href" in part ? part.href : part.text))
    .join("");
  assert.equal(rebuilt, body);
});

test("formatAgo says 'just now' under a minute", () => {
  assert.equal(formatAgo(new Date(NOW.getTime() - 30_000), NOW), "just now");
});

test("formatAgo never reports a negative age for a slightly-future timestamp", () => {
  assert.equal(formatAgo(new Date(NOW.getTime() + 5_000), NOW), "just now");
});

test("formatAgo counts in hours past an hour, and days past a day", () => {
  assert.equal(formatAgo(new Date(NOW.getTime() - 90 * 60 * 1000), NOW), "1h ago");
  assert.equal(formatAgo(new Date(NOW.getTime() - 23 * 60 * 60 * 1000), NOW), "23h ago");
  assert.equal(formatAgo(daysAgo(1), NOW), "1d ago");
  assert.equal(formatAgo(daysAgo(6.5), NOW), "6d ago");
});

test("formatAgo floors rather than rounds, so nothing reads as older than it is", () => {
  // Rounding made a 59m59s-old message say "1h ago", which on a 7-day
  // window is a message the reader is about to go looking for by time.
  assert.equal(formatAgo(new Date(NOW.getTime() - 59.9 * 60 * 1000), NOW), "59m ago");
});
