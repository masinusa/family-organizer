import type { CategoryChip } from "./categories.js";
import { RSVP_LABELS, RSVP_STATUSES, type FormValues } from "./event-input.js";
import { avatarForEmail, avatarForName, type Avatar } from "./people.js";
import type { RsvpStatus, UserDoc } from "./types.js";

export interface RosterEntry {
  email: string;
  avatar: Avatar;
  /** null when they're not on this event. */
  status: RsvpStatus | null;
}

export interface GuestEntry {
  index: number;
  name: string;
  status: RsvpStatus;
  avatar: Avatar | null;
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
  members: UserDoc[],
  categories: CategoryChip[],
): Record<string, unknown> {
  const roster: RosterEntry[] = members.map((member) => ({
    email: member.email,
    avatar: avatarForEmail(member.email),
    status: (values.memberStatuses[member.email] as RsvpStatus | undefined) ?? null,
  }));

  const guestRows: GuestEntry[] = values.guests.map((guest, index) => ({
    index,
    name: guest.name,
    status: guest.status,
    avatar: guest.name.trim() ? avatarForName(guest.name) : null,
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
      ...roster.filter((entry) => entry.status !== null).map((entry) => entry.avatar),
      ...guestRows.map((guest) => guest.avatar).filter((a): a is Avatar => a !== null),
    ],
    detailsSummary: detailsSummary(values),
    /** Index the first JS-added guest row should use. */
    nextGuestIndex: guestRows.length,
  };
}
