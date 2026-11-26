import type { CategoryChip } from "./categories.js";
import { RSVP_LABELS, RSVP_STATUSES, type FormValues } from "./event-input.js";
import { guestPersona, type Persona } from "./persona.js";
import type { RsvpStatus } from "./types.js";

export interface RosterEntry {
  /** An active persona, so `email` is always set — it's the field key. */
  persona: Persona;
  /** null when they're not on this event. */
  status: RsvpStatus | null;
}

export interface GuestEntry {
  index: number;
  name: string;
  status: RsvpStatus;
  /** null for a row with no name yet. */
  persona: Persona | null;
}

/** How long a location can be before the collapsed summary trims it. */
const SUMMARY_MAX = 28;

function truncate(text: string): string {
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : text;
}

/**
 * What the collapsed "Details" row says, so it's worth opening only when
 * there's something in there.
 */
export function detailsSummary(values: FormValues): string {
  const parts: string[] = [];
  const location = values.location.trim();
  if (location) {
    parts.push(truncate(location));
  }
  if (values.link.trim()) {
    parts.push("link");
  }
  if (values.description.trim()) {
    parts.push("notes");
  }
  return parts.length > 0 ? parts.join(" · ") : "Add a place, link or notes";
}

/**
 * Everything `views/_event-fields.eta` needs, built once so the full-page
 * form and the calendar's quick-add modal can't fall out of step. Pure —
 * the caller does the Firestore reads.
 */
export function eventFieldsData(
  values: FormValues,
  members: Persona[],
  categories: CategoryChip[],
): Record<string, unknown> {
  const roster: RosterEntry[] = members.map((persona) => ({
    persona,
    status: (values.memberStatuses[persona.email!] as RsvpStatus | undefined) ?? null,
  }));

  const guestRows: GuestEntry[] = values.guests.map((guest, index) => ({
    index,
    name: guest.name,
    status: guest.status,
    persona: guest.name.trim() ? guestPersona(guest.name.trim()) : null,
  }));

  return {
    values,
    roster,
    guestRows,
    categories,
    statuses: RSVP_STATUSES.map((status) => ({ value: status, label: RSVP_LABELS[status] })),
    selectedCategory: categories.find((c) => c.id === values.categoryId) ?? null,
    // Shown on the collapsed "Who's involved" row.
    involved: [
      ...roster.filter((entry) => entry.status !== null).map((entry) => entry.persona),
      ...guestRows.map((guest) => guest.persona).filter((p): p is Persona => p !== null),
    ],
    detailsSummary: detailsSummary(values),
    /** Index the first JS-added guest row should use. */
    nextGuestIndex: guestRows.length,
  };
}
