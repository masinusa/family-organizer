import { normalizeEmail } from "./email.js";
import { parseLink } from "./event-input.js";
import type { SubscriptionInput } from "./types.js";

export const NAME_MAX = 60;
export const NOTES_MAX = 500;
export const PHONE_MAX = 40;
export const MAIL_FROM_MAX = 100;

/**
 * An address or domain, nothing else. This value is compiled into an IMAP
 * SEARCH command, so a space, a quote or a newline has no business in it —
 * rejected outright rather than escaped, the same call parseLink makes about
 * a `javascript:` URL.
 */
const MAIL_FROM_PATTERN = /^[a-z0-9._%+-]+(?:@[a-z0-9._-]+)?$/;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Only the name is required — a subscription someone half-remembers paying
 * for is still worth listing, and the account email/phone are often exactly
 * what we're trying to find out.
 */
export function parseSubscriptionInput(
  body: Record<string, unknown> | null | undefined,
): SubscriptionInput | { error: string } {
  const fields = body ?? {};

  const name = str(fields.name);
  if (!name) return { error: "A name is required." };
  if (name.length > NAME_MAX) return { error: `A name must be ${NAME_MAX} characters or fewer.` };

  const accountPhone = str(fields.accountPhone);
  if (accountPhone.length > PHONE_MAX) {
    return { error: `A phone number must be ${PHONE_MAX} characters or fewer.` };
  }

  const notes = str(fields.notes);
  if (notes.length > NOTES_MAX) {
    return { error: `Notes must be ${NOTES_MAX} characters or fewer.` };
  }

  // Same shape-validation the event link gets: Eta escapes the attribute,
  // but escaping alone wouldn't stop a `javascript:` href reaching it.
  const parsedLink = parseLink(str(fields.link));
  if ("error" in parsedLink) return parsedLink;

  const mailFrom = str(fields.mailFrom).toLowerCase();
  if (mailFrom.length > MAIL_FROM_MAX) {
    return { error: `A mail sender must be ${MAIL_FROM_MAX} characters or fewer.` };
  }
  if (mailFrom && !MAIL_FROM_PATTERN.test(mailFrom)) {
    return { error: "A mail sender must be an address or a domain, like netflix.com." };
  }

  const accountEmail = str(fields.accountEmail);

  return {
    name,
    // Normalized so comparing it against the family mailbox address (which
    // decides whether Recent mail is offered) can't miss on casing.
    accountEmail: accountEmail ? normalizeEmail(accountEmail) : null,
    accountPhone: accountPhone || null,
    link: parsedLink.link,
    notes: notes || null,
    mailFrom: mailFrom || null,
  };
}

/**
 * The access list comes from a roster of checkboxes named `member:<email>`,
 * so it is only ever read against the known member list — never by scanning
 * submitted field names, same rule the event roster follows.
 *
 * The flat `fields["member:..."]` lookup relies on app.ts parsing bodies with
 * `express.urlencoded({ extended: false })`: under `extended: true`, qs would
 * read the dots in an email address as nested paths and `member:a.b@c.com`
 * would arrive as an object tree instead of one key.
 */
export function parseMemberEmails(
  body: Record<string, unknown> | null | undefined,
  knownEmails: string[],
): string[] {
  const fields = body ?? {};
  return knownEmails
    .map((email) => normalizeEmail(email))
    .filter((email) => Boolean(fields[`member:${email}`]));
}

/**
 * Which stored password a reveal is asking for. Null means "the current
 * one", i.e. no version was submitted — the plain "Get password" button.
 *
 * A submitted version is only ever accepted if it is one this subscription
 * actually recorded: the value reaches a Secret Manager resource path, and
 * the history is also the access boundary, so a viewer can't read a version
 * belonging to some other secret or one this app never saved.
 */
export function parsePasswordVersion(
  body: Record<string, unknown> | null | undefined,
  knownVersions: string[],
): { version: string | null } | { error: string } {
  const submitted = str((body ?? {}).version);
  if (!submitted) return { version: null };
  if (!knownVersions.includes(submitted)) {
    return { error: "That password isn't in this subscription's history." };
  }
  return { version: submitted };
}
