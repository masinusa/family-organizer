/**
 * The one way a person is represented anywhere on the site. Pure — no
 * Firestore, same separation as calendar-grid.ts — so the join and every
 * presentation rule are unit-testable. The middleware in
 * middleware/personas.ts loads the two collections once per request and
 * hands routes a PersonaDirectory; templates draw a Persona with the
 * views/_persona-*.eta partials and nothing else.
 */
import { normalizeEmail } from "./email.js";
import type { Attendee, FeatureKey, PersonCircle, PersonDoc, UserDoc, UserRole } from "./types.js";


export interface PersonaColor {
  key: string;
  label: string;
  /** Circle fill. */
  tint: string;
  /** Initials on top of the tint. */
  ink: string;
}

/**
 * Muted tints chosen to sit with the existing cream/sage/gold tokens.
 * People pick a key, never a raw hex, so no choice can clash with the
 * rest of the page.
 */
export const PERSONA_COLORS: PersonaColor[] = [
  { key: "sage", label: "Sage", tint: "#dde7dc", ink: "#3f6446" },
  { key: "clay", label: "Clay", tint: "#f0ddd2", ink: "#8a5438" },
  { key: "butter", label: "Butter", tint: "#f6e9c9", ink: "#8a6a22" },
  { key: "sky", label: "Sky", tint: "#d8e4ec", ink: "#3c6076" },
  { key: "rose", label: "Rose", tint: "#f1dcdf", ink: "#8a4a57" },
  { key: "lilac", label: "Lilac", tint: "#e2dcec", ink: "#5c4a7a" },
];

export const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * First letter of the first and last name parts ("Willa Spicer" -> "WS").
 * Array.from, not [0], so an accented or non-BMP first character isn't
 * sliced in half.
 */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0]!)[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Stable across calls so a person's color doesn't change between renders. */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * An explicit choice wins; otherwise derive one from the name so every
 * card is colored even before anyone edits their persona.
 */
export function colorFor(person: { name: string; color: string | null }): PersonaColor {
  const chosen = PERSONA_COLORS.find((c) => c.key === person.color);
  if (chosen) return chosen;
  return PERSONA_COLORS[hashString(person.name) % PERSONA_COLORS.length]!;
}

/**
 * For an email nobody on the tree has any more (an old attendee or event
 * creator whose access was removed and email changed). Deliberately grey:
 * it must not borrow somebody else's colour.
 */
export const UNKNOWN_COLOR: PersonaColor = {
  key: "unknown",
  label: "Unknown",
  tint: "#e7e5de",
  ink: "#5f6157",
};

export type PersonaKind = "person" | "guest" | "unknown";

/**
 * A person as the site shows them, resolved once: tree name, account (if
 * any), initials and colour. Plain data rather than a class so an Eta
 * template can read every field directly.
 */
export interface Persona {
  /** Stable and unique per persona — the person id, or a prefixed name/email. */
  key: string;
  kind: PersonaKind;
  /** The `people` doc, for a person on the tree; null for a guest or unknown. */
  personId: string | null;
  /** Family (on the tree) or friend (not); null for a guest or unknown. */
  circle: PersonCircle | null;
  name: string;
  email: string | null;
  /** Non-null exactly when they can sign in — what "active" means. */
  role: UserRole | null;
  initials: string;
  color: PersonaColor;
  /** The second line under the name: account, "Not signed in", "Guest"… */
  subtitle: string;
}

export const ORPHAN_ACCOUNT_ERROR =
  'has an account but nobody on the tree — run "npm run migrate:personas".';

/**
 * A friend account on somebody on the tree, or a family account on a
 * friend, would let a role decide what a circle should — the gate reads
 * the role, the tree reads the circle, and they'd disagree about one person.
 */
export const CIRCLE_MISMATCH_ERROR = "has an account whose role doesn't match their circle.";

function accountSubtitle(person: PersonDoc, account: UserDoc | null): string {
  if (!account) return person.circle === "friend" ? "Friend · not signed in" : "Not signed in";
  return `${account.email} · ${account.role}`;
}

function personPersona(person: PersonDoc, account: UserDoc | null): Persona {
  return {
    key: person.id,
    kind: "person",
    personId: person.id,
    circle: person.circle,
    name: person.name,
    email: person.email ? normalizeEmail(person.email) : null,
    role: account?.role ?? null,
    initials: initialsFor(person.name),
    color: colorFor(person),
    subtitle: accountSubtitle(person, account),
  };
}

/** Someone on one event only — no account, not on the tree. */
export function guestPersona(name: string): Persona {
  return {
    key: `guest:${name.toLowerCase()}`,
    kind: "guest",
    personId: null,
    circle: null,
    name,
    email: null,
    role: null,
    initials: initialsFor(name),
    color: colorFor({ name, color: null }),
    subtitle: "Guest",
  };
}

function unknownPersona(email: string): Persona {
  const key = normalizeEmail(email);
  return {
    key: `email:${key}`,
    kind: "unknown",
    personId: null,
    circle: null,
    name: key,
    email: key,
    role: null,
    initials: initialsFor(key),
    color: UNKNOWN_COLOR,
    subtitle: "No longer on the tree",
  };
}

function byName(a: Persona, b: Persona): number {
  return a.name.localeCompare(b.name);
}

/**
 * The `people`/`users` join, done once. There's no link field between
 * the collections: a person's email IS the join key (normalized on both
 * sides). Every account must belong to somebody on the tree — an account
 * that doesn't is a bug the routes no longer allow, so it throws rather
 * than inventing a name for it.
 */
export class PersonaDirectory {
  private readonly everyone: Persona[];
  private readonly ids = new Map<string, Persona>();
  private readonly emails = new Map<string, Persona>();
  private readonly accounts = new Map<string, UserDoc>();

  /**
   * The docs it was built from, for what needs more than a Persona — the
   * tree layout, birthdays, relationship rules. Drawing anyone goes
   * through a Persona, never through these. `people` is everyone, friends
   * included; `family` is only those on the tree.
   */
  readonly people: PersonDoc[];
  readonly family: PersonDoc[];

  constructor(people: PersonDoc[], users: UserDoc[]) {
    this.people = people;
    this.family = people.filter((person) => person.circle === "family");
    const accountByEmail = new Map(users.map((u) => [normalizeEmail(u.email), u]));
    const accountOf = (person: PersonDoc) =>
      person.email ? (accountByEmail.get(normalizeEmail(person.email)) ?? null) : null;

    for (const person of people) {
      const account = accountOf(person);
      if (account && (account.role === "friend") !== (person.circle === "friend")) {
        throw new Error(`${account.email} ${CIRCLE_MISMATCH_ERROR}`);
      }
      if (account) this.accounts.set(person.id, account);
    }

    this.everyone = people.map((person) => personPersona(person, accountOf(person))).sort(byName);

    for (const persona of this.everyone) {
      this.ids.set(persona.personId!, persona);
      // First claim wins; the email route refuses to create a second one.
      if (persona.email && !this.emails.has(persona.email)) this.emails.set(persona.email, persona);
    }

    for (const email of accountByEmail.keys()) {
      if (!this.emails.has(email)) throw new Error(`${email} ${ORPHAN_ACCOUNT_ERROR}`);
    }
  }

  /** Everyone on the tree, by name. Friends are never in it. */
  all(): Persona[] {
    return this.everyone.filter((p) => p.circle === "family");
  }

  /** Every family member who can sign in, by name. */
  active(): Persona[] {
    return this.all().filter((p) => p.role !== null);
  }

  /** Everyone kept off the tree on purpose, by name. */
  friends(): Persona[] {
    return this.everyone.filter((p) => p.circle === "friend");
  }

  /** Family and friends alike — everyone who can sign in, by name. */
  withAccounts(): Persona[] {
    return this.everyone.filter((p) => p.role !== null);
  }

  /** The friend's account opt-ins; family accounts have none and need none. */
  optInsOf(persona: Persona): FeatureKey[] {
    return persona.personId ? (this.accounts.get(persona.personId)?.optIns ?? []) : [];
  }

  /**
   * Who a feature's people-pickers may offer: every family account, plus
   * the friends an admin opted into it. Participation-based access isn't
   * here — that's per-feature and needs its own read.
   */
  audience(key: FeatureKey): Persona[] {
    return this.withAccounts().filter((p) => p.circle === "family" || this.optInsOf(p).includes(key));
  }

  byId(id: string): Persona | null {
    return this.ids.get(id) ?? null;
  }

  byEmail(email: string): Persona | null {
    return this.emails.get(normalizeEmail(email)) ?? null;
  }

  /** For a stored email reference, which may outlive the person it named. */
  forEmail(email: string): Persona {
    return this.byEmail(email) ?? unknownPersona(email);
  }

  forAttendee(attendee: Attendee): Persona {
    if (attendee.email) return this.forEmail(attendee.email);
    return guestPersona(attendee.name!);
  }
}

/** "Mar 4" — the day only; the year is tracked and shown separately. */
export function formatBirthday(month: number | null, day: number | null): string | null {
  if (!month || !day) return null;
  const label = MONTH_NAMES[month - 1];
  if (!label) return null;
  return `${label} ${day}`;
}

/** Old enough for any realistic ancestor, but still a guard against typos. */
export const MIN_BIRTH_YEAR = 1800;

export function isValidBirthYear(year: number, now: Date = new Date()): boolean {
  return Number.isInteger(year) && year >= MIN_BIRTH_YEAR && year <= now.getFullYear();
}

/** Days available for a month, ignoring leap years (Feb always offers 29). */
export function daysInMonth(month: number): number {
  const lengths = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1] ?? 31;
}
