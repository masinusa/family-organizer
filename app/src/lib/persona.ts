/**
 * Pure presentation helpers for a person's card — no Firestore, same
 * separation as calendar-grid.ts, so all of this is unit-testable.
 */

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
