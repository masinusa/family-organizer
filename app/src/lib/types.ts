export interface EventDoc {
  id: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  location: string | null;
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
