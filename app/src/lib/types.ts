export type RsvpStatus = "invited" | "yes" | "maybe" | "no";

/**
 * One person attached to an event. Exactly one of `email`/`name` is set:
 * `email` for a family member (matches a `users` doc id), `name` for an
 * off-app guest — extended family who have no account here but still need
 * to show up when we're working out who'll be where.
 */
export interface Attendee {
  email: string | null;
  name: string | null;
  status: RsvpStatus;
}

export interface EventDoc {
  id: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  location: string | null;
  link: string | null;
  categoryId: string | null;
  attendees: Attendee[];
  recurrenceRule: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventInput {
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  location: string | null;
  link: string | null;
  categoryId: string | null;
  attendees: Attendee[];
}

/**
 * A colour-coded label for events. `builtIn` ones live in code
 * (`DEFAULT_CATEGORIES`); the rest are Firestore docs any family member can
 * add. `id` is the doc id / slug and is what an event stores.
 */
export interface CategoryDoc {
  id: string;
  name: string;
  color: string;
  builtIn: boolean;
}

export type UserRole = "admin" | "member";

export interface UserDoc {
  email: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface PersonDoc {
  id: string;
  name: string;
  /** Also the join key to a `users` account — see lib/family-link.ts. */
  email: string | null;
  blurb: string | null;
  /**
   * Month/day and year are deliberately independent: a birthday is often
   * known without the year, and a year without the exact date.
   */
  birthMonth: number | null;
  birthDay: number | null;
  birthYear: number | null;
  /** A key into PERSONA_COLORS, not a raw hex — see lib/persona.ts. */
  color: string | null;
  parentIds: string[];
  /**
   * The generic sideways link: two people drawn on the same row with a
   * plain line between them. Partners are the common case, but it is
   * deliberately unlabelled — co-parents, a carer, or anyone else who
   * belongs alongside rather than above or below. Always reciprocal.
   *
   * The UI calls one of these a "relationship" (you add either a parent or
   * a relationship). The field stays `connectionIds` because in code that
   * word has to mean *only* the sideways link — a parent is a relationship
   * too, so `relationshipIds` would read as if it held both.
   */
  connectionIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** The self-service half of a person: what they can edit about themselves. */
export interface PersonaInput {
  name: string;
  blurb: string | null;
  birthMonth: number | null;
  birthDay: number | null;
  birthYear: number | null;
  color: string | null;
}

export type FeedbackCategory = "general" | "bug" | "idea";
export type FeedbackStatus = "new" | "reviewed" | "resolved";

export interface FeedbackInput {
  message: string;
  category: FeedbackCategory;
}

export interface FeedbackDoc extends FeedbackInput {
  id: string;
  submittedBy: string;
  status: FeedbackStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One paid service the family shares. Deliberately holds no password: the
 * value lives in Secret Manager under a name derived from `id` (see
 * lib/secret-store.ts), and `hasPassword` is the only trace of it here, so
 * a Firestore read — or a leaked export of it — never carries a credential.
 */
export interface SubscriptionDoc {
  id: string;
  name: string;
  /** The address the service itself is registered to, not a family member's. */
  accountEmail: string | null;
  accountPhone: string | null;
  link: string | null;
  notes: string | null;
  /**
   * Which sender to search the shared family mailbox for — an address or
   * domain like `netflix.com`. Null for most subscriptions, and required
   * before this one offers to read mail at all: a search narrowed to one
   * service's sender is what makes reading a mailbox nobody on the access
   * list owns acceptable (ADR 0007).
   */
  mailFrom: string | null;
  hasPassword: boolean;
  /** Family members who can see it and reveal its password, normalized. */
  memberEmails: string[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** The admin-editable half of a subscription — everything but access and the secret. */
export interface SubscriptionInput {
  name: string;
  accountEmail: string | null;
  accountPhone: string | null;
  link: string | null;
  notes: string | null;
  mailFrom: string | null;
}

export type RevealAction = "password" | "mail";

/**
 * One "someone took the shared credential" record. Shown on the
 * subscription's page: letting anyone on the list grab a password without
 * asking is the point, so the honest counterpart is that it's on the record.
 */
export interface RevealDoc {
  id: string;
  email: string;
  action: RevealAction;
  /**
   * Which stored password was taken, for `action: "password"`: a Secret
   * Manager version id, or null for the current one (and for every reveal
   * recorded before the history existed).
   */
  version: string | null;
  at: Date;
}

/**
 * One password save. Secret Manager keeps the values and their timestamps,
 * but has no idea who asked for the change, so this is the record of that —
 * and the index the history list on a subscription's page is built from,
 * since the app never lists versions out of Secret Manager itself.
 *
 * `version` is also the doc id, so re-recording a save is idempotent.
 */
export interface PasswordVersionDoc {
  version: string;
  setBy: string;
  at: Date;
}
