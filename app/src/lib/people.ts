import { contrastInk } from "./categories.js";
import type { Attendee } from "./types.js";

/**
 * Deliberately all dark enough that every avatar gets white text, so a
 * roster reads as one set rather than a ransom note. Distinct from the
 * category colours — a person is not a category.
 */
const AVATAR_COLORS = [
  "#7b4b94",
  "#2e6f6a",
  "#b2562e",
  "#4a6fa5",
  "#8a6d3b",
  "#9c3f5a",
  "#3f7d3c",
  "#6b5b95",
];

export interface Avatar {
  /** What to call them: "Mary Jane" rather than "mary.jane+cal@gmail.com". */
  label: string;
  /** The email, when the label was derived from one — otherwise null. */
  sub: string | null;
  initial: string;
  color: string;
  ink: string;
}

/**
 * Turns an email into something a person would recognise: the local part,
 * minus any `+tag`, with separators as spaces and each word capitalised.
 * Falls back to the whole address if that leaves nothing.
 */
export function displayName(email: string): string {
  const local = email.split("@")[0]!.split("+")[0]!;
  const words = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length > 0 ? words.join(" ") : email;
}

export function initialOf(label: string): string {
  const letter = label.trim().match(/[\p{L}\p{N}]/u);
  return letter ? letter[0]!.toUpperCase() : "?";
}

/** Stable across renders, so someone keeps the same colour everywhere. */
export function avatarColor(key: string): string {
  const normalized = key.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) % 100000;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

function makeAvatar(key: string, label: string, sub: string | null): Avatar {
  const color = avatarColor(key);
  return { label, sub, initial: initialOf(label), color, ink: contrastInk(color) };
}

export function avatarForEmail(email: string): Avatar {
  return makeAvatar(email, displayName(email), email);
}

export function avatarForName(name: string): Avatar {
  return makeAvatar(name, name, null);
}

export function avatarFor(attendee: Attendee): Avatar {
  return attendee.email ? avatarForEmail(attendee.email) : avatarForName(attendee.name ?? "Guest");
}
