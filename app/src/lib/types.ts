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
  partnerIds: string[];
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
