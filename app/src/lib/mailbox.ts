import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { config } from "../config.js";
import { getSecret } from "./secret-store.js";

/** The one place the mailbox app password is named. Created by Terraform, filled in by hand. */
export const MAILBOX_SECRET_ID = "family-mailbox-app-password";

const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;

/**
 * How far back a search looks. What keeps this from being a general-purpose
 * inbox reader is the *sender*, not the clock: every read is narrowed to one
 * subscription's own sender (`mailFrom`), so a week of one service's mail
 * exposes far less of a shared mailbox than fifteen unfiltered minutes did.
 * Long enough for a password reset, a sign-in code, and the last bill.
 */
export const WINDOW_DAYS = 7;

/** Cap on messages fetched per search, so a chatty sender can't run the request long. */
const FETCH_COUNT = 20;

/**
 * Cap on the body text handed to a page. A marketing email's plain-text
 * twin can run to tens of kilobytes of footer, and twenty of those is a
 * page nobody wants. Generous enough that a real message arrives whole;
 * when it doesn't, the view says so rather than trailing off silently.
 */
const BODY_MAX = 10000;

const TIMEOUT_MS = 8000;

/**
 * What the view renders: the list shows sender/subject/age, and the body is
 * behind a click.
 *
 * This deliberately carries the whole plain-text body rather than a
 * 180-character snippet plus a guessed one-time code, which is what it used
 * to do. The guess was a regex for a standalone 4-8 digit run, and on real
 * Netflix mail it returned the last four digits of the support phone number
 * and a segment of a UUID in a help URL — presented as a sign-in code, in a
 * box styled to look authoritative. Both matches also sat ~1500 characters
 * past the end of the snippet shown beside them, so the thing that was
 * supposed to make a wrong guess obvious couldn't. Showing the message and
 * letting the reader find the code is both less code and less wrong.
 */
export interface MailMessage {
  from: string;
  subject: string;
  /**
   * The body split into text runs and links, so the view can render a link
   * as something clickable without ever building HTML itself. Newlines are
   * intact inside the text runs — the view renders them pre-wrapped.
   */
  parts: BodyPart[];
  /** True when BODY_MAX trimmed it, so the view can say the rest is missing. */
  bodyTrimmed: boolean;
  ago: string;
}

/** The shape the pure mapper takes, so it's testable without a mailbox. */
export interface RawMessage {
  from: string | null;
  subject: string | null;
  date: Date | null;
  text: string | null;
}

export function isConfigured(): boolean {
  return Boolean(config.familyMailboxAddress);
}

/** Whether this subscription is registered to the mailbox we can actually log into. */
export function isFamilyMailbox(accountEmail: string | null): boolean {
  if (!isConfigured() || !accountEmail) return false;
  return accountEmail.trim().toLowerCase() === config.familyMailboxAddress;
}

function collapse(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/**
 * Readable plain text, not collapsed: a text/plain email's line breaks are
 * its only structure, and a code on its own line is exactly what someone is
 * here to read. CRLF is normalized because that is what the wire format
 * uses, and runs of blank lines are squeezed to one because the HTML-twin
 * generators that produce these bodies pad them heavily.
 */
export function bodyOf(text: string | null): { body: string; bodyTrimmed: boolean } {
  const normalized = (text ?? "")
    .replace(/\r\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (normalized.length <= BODY_MAX) return { body: normalized, bodyTrimmed: false };
  return { body: normalized.slice(0, BODY_MAX).trimEnd(), bodyTrimmed: true };
}

/** A run of body text, or a link lifted out of it. */
export type BodyPart = { text: string } | { href: string; label: string };

/** Longest link label rendered; the href keeps the whole URL regardless. */
const LABEL_MAX = 60;

/**
 * A link's visible text: host plus path, with the query string dropped.
 * These URLs carry a tracking query that can run to hundreds of characters
 * (one real Netflix verify link is 446), which is unreadable and buries the
 * one part a reader should check before clicking — the host. The full URL
 * stays in the href and in `title`, so nothing is hidden, and the host is
 * always the first thing shown so a link can't dress up as another site.
 */
function labelFor(url: URL): string {
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/u, "");
  const label = `${url.host}${path}`;
  return label.length <= LABEL_MAX ? label : `${label.slice(0, LABEL_MAX)}…`;
}

/**
 * Splits a body into text runs and links so the view can render a real
 * anchor instead of a URL to copy by hand.
 *
 * The parts are data, not markup: the view escapes each run and builds the
 * anchor itself, so this never produces HTML. Two details earn their keep:
 *
 * - **Trailing punctuation is pushed back into the text.** "Verify at
 *   https://x.test/a." must not link to a URL ending in a full stop, and a
 *   URL inside brackets must not swallow the closing one. A closing paren is
 *   only kept when the URL opened one, which is how a Wikipedia-style
 *   `(…)_(disambiguation)` link survives.
 * - **Only http and https become links.** `new URL` accepts `javascript:`
 *   and `data:` happily; the pattern below never matches them, and the
 *   protocol is checked again after parsing rather than trusted. Same rule
 *   as `parseLink`, which guards the same sink from the event form.
 *
 * The href is `URL`'s normalized form of what the email wrote, not the
 * original characters: a non-ASCII host comes back punycoded. That is the
 * safer of the two — an IDN host rendered in its own script is how a
 * lookalike domain passes for a real one — so the label shows the punycode
 * too rather than prettying it back up.
 *
 * The one thing it cannot fix is a URL the sender wrapped across two lines,
 * which would link to the first half. Every URL in the real mail sits alone
 * on its own line, unwrapped, even at 446 characters — so this stays a
 * known limit rather than a guess to code around.
 */
export function toBodyParts(body: string): BodyPart[] {
  // Case-insensitive: a plain-text email that writes "HTTP://" means a link,
  // and `new URL` lowercases the scheme and host for the href anyway.
  const pattern = /https?:\/\/[^\s<>"']+/giu;
  const parts: BodyPart[] = [];
  let cursor = 0;

  for (const match of body.matchAll(pattern)) {
    const start = match.index;
    let candidate = match[0];

    // Punctuation that ends a sentence, not a URL.
    let trailing = "";
    for (;;) {
      const last = candidate.at(-1)!;
      const sentenceEnd = ".,;:!?".includes(last);
      const unopenedBracket =
        (last === ")" && !candidate.includes("(")) ||
        (last === "]" && !candidate.includes("[")) ||
        (last === ">" && !candidate.includes("<"));
      if (!sentenceEnd && !unopenedBracket) break;
      trailing = last + trailing;
      candidate = candidate.slice(0, -1);
    }

    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    // Belt and braces: the pattern already requires http(s).
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;

    if (start > cursor) parts.push({ text: body.slice(cursor, start) });
    parts.push({ href: url.href, label: labelFor(url) });
    cursor = start + candidate.length;
    if (trailing) {
      parts.push({ text: trailing });
      cursor += trailing.length;
    }
  }

  if (cursor < body.length) parts.push({ text: body.slice(cursor) });
  return parts;
}

/** Minutes were enough for a 15-minute window; a week needs hours and days too. */
export function formatAgo(at: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Case-insensitive substring of the From header, matching what IMAP's FROM key does. */
function isFromSender(from: string | null, sender: string): boolean {
  return (from ?? "").toLowerCase().includes(sender.toLowerCase());
}

/**
 * Pure: applies the real window and sender, newest first, and shapes each
 * message for the view.
 *
 * Both filters are re-applied here even though the IMAP search already
 * carried them. The date because SINCE is day-granular and cannot express
 * an exact cutoff, so the server returns up to a day more than asked. The
 * sender because it is now the whole privacy boundary — a page promising
 * "Netflix mail" must not render somebody's unrelated private mail because
 * a search behaved differently than expected.
 */
export function toServiceMessages(raw: RawMessage[], sender: string, now: Date): MailMessage[] {
  const cutoff = now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return raw
    .filter((message) => message.date !== null && message.date.getTime() >= cutoff)
    .filter((message) => isFromSender(message.from, sender))
    .sort((a, b) => b.date!.getTime() - a.date!.getTime())
    .slice(0, FETCH_COUNT)
    .map((message) => {
      const { body, bodyTrimmed } = bodyOf(message.text);
      return {
        from: collapse(message.from ?? "") || "Unknown sender",
        subject: collapse(message.subject ?? "") || "(no subject)",
        parts: toBodyParts(body),
        bodyTrimmed,
        ago: formatAgo(message.date!, now),
      };
    });
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function readRaw(password: string, sender: string, since: Date): Promise<RawMessage[]> {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: config.familyMailboxAddress, pass: password },
    // Default logging prints message metadata; this mailbox's contents must
    // not reach Cloud Logging.
    logger: false,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });

  await client.connect();
  try {
    // readOnly so nothing is ever marked as read: someone fetching a code
    // here must not change what the mailbox's owner sees as unread.
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      // The server does the narrowing: FROM is a substring match on the From
      // header, SINCE a date (it ignores the time, so this is the start of
      // that day — toServiceMessages applies the exact cutoff).
      //
      // Searching first and fetching the result, rather than handing the
      // same query straight to fetch(), is what makes the cap below
      // possible: a sender with 300 messages in the window would otherwise
      // all be fetched and MIME-parsed before anything could trim them.
      const uids = await client.search({ from: sender, since }, { uid: true });
      if (!Array.isArray(uids) || uids.length === 0) return [];

      // UIDs ascend with arrival, so the tail is the newest.
      const newest = uids.slice(-FETCH_COUNT);
      const raw: RawMessage[] = [];
      for await (const message of client.fetch(newest, { source: true }, { uid: true })) {
        if (!message.source) continue;
        // Annotated because simpleParser's callback overload otherwise wins
        // overload resolution and the result comes back as void.
        const parsed: ParsedMail = await simpleParser(message.source);
        raw.push({
          from: parsed.from?.text ?? null,
          subject: parsed.subject ?? null,
          date: parsed.date ?? null,
          text: parsed.text ?? null,
        });
      }
      return raw;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/**
 * One service's mail from the shared mailbox: everything from `sender` in
 * the last WINDOW_DAYS. `sender` is a subscription's own `mailFrom` — an
 * address or domain like `netflix.com` — and is the only reason it is
 * acceptable for a family member to read a mailbox they don't own.
 *
 * Nothing is persisted and nothing is logged but counts: the content passes
 * straight through to one page render.
 */
export async function readServiceMail(sender: string, now = new Date()): Promise<MailMessage[]> {
  if (!isConfigured()) throw new Error("No family mailbox is configured.");
  if (!sender) throw new Error("No sender to search the family mailbox for.");

  const password = await getSecret(MAILBOX_SECRET_ID);
  if (!password) throw new Error("No app password is stored for the family mailbox.");

  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const raw = await withTimeout(readRaw(password, sender, since), "Reading the family mailbox");
  const messages = toServiceMessages(raw, sender, now);
  console.log(`Searched family mailbox: ${raw.length} fetched, ${messages.length} within the window.`);
  return messages;
}

/** Object form so routes can be tested with the IMAP call stubbed out. */
export const mailbox = { readServiceMail };
