import { Timestamp, type DocumentData } from "@google-cloud/firestore";
import { firestore } from "./firestore.js";
import type { CategoryDoc } from "./types.js";

const categoriesCollection = () => firestore.collection("categories");

/** Matches `--ink` in views/layout.eta. */
const INK = "#26291f";
const WHITE = "#ffffff";

export const CATEGORY_NAME_MAX = 40;

/**
 * Built-ins live in code rather than in Firestore so there's no seeding
 * step, no empty-state to render, and nothing to re-create if the
 * collection is ever wiped. Custom categories are Firestore docs on top of
 * these — see listCategories.
 */
export const DEFAULT_CATEGORIES: CategoryDoc[] = [
  { id: "holiday", name: "Holiday", color: "#a8342a", builtIn: true },
  { id: "family-event", name: "Family event", color: "#2f5233", builtIn: true },
  { id: "trip", name: "Trip", color: "#2b6a8f", builtIn: true },
  { id: "birthday", name: "Birthday", color: "#8a4f9e", builtIn: true },
  { id: "appointment", name: "Appointment", color: "#6b705c", builtIn: true },
];

/**
 * What an event with no category — or one naming a category that's since
 * been deleted — renders as. Its existence is why deleting a category never
 * has to touch a single event doc.
 */
export const FALLBACK_CATEGORY: CategoryDoc = {
  id: "",
  name: "No category",
  color: "#8d8878",
  builtIn: true,
};

export function isValidHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

/**
 * Accepts what someone might actually type into the hex box — with or
 * without the `#`, 3- or 6-digit, any case — and returns the canonical
 * `#rrggbb` form, or null if it isn't a colour at all. Nothing that fails
 * this may ever reach a `style` attribute.
 */
export function normalizeHexColor(value: string): string | null {
  const raw = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    const [r, g, b] = raw.toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return /^[0-9a-f]{6}$/i.test(raw) ? `#${raw.toLowerCase()}` : null;
}

export function slugifyCategoryName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, CATEGORY_NAME_MAX);
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number | null {
  if (!isValidHexColor(hex)) {
    return null;
  }
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

function ratio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Picks white or ink for text sitting on `hex`, whichever contrasts more.
 * Family members pick their own colours, so no fixed text colour is safe.
 */
export function contrastInk(hex: string): string {
  const l = luminance(hex);
  if (l === null) {
    return INK;
  }
  return ratio(l, 1) >= ratio(l, luminance(INK)!) ? WHITE : INK;
}

/** Built-ins in their declared order, then custom ones alphabetically. */
export function mergeCategories(custom: CategoryDoc[]): CategoryDoc[] {
  const sorted = [...custom].sort((a, b) => a.name.localeCompare(b.name));
  return [...DEFAULT_CATEGORIES, ...sorted];
}

export function resolveCategory(
  categoryId: string | null,
  categories: CategoryDoc[],
): CategoryDoc {
  if (!categoryId) {
    return FALLBACK_CATEGORY;
  }
  return categories.find((c) => c.id === categoryId) ?? FALLBACK_CATEGORY;
}

/**
 * Pure so it's unit-testable without an emulator (same reason isLastAdmin
 * in users-repo.ts is split out). `existing` is the merged list, so a
 * custom name can't shadow a built-in either.
 */
export function validateNewCategory(
  name: string,
  color: string,
  existing: CategoryDoc[],
): { id: string; name: string; color: string } | { error: string } {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return { error: "A category name is required." };
  }
  if (trimmed.length > CATEGORY_NAME_MAX) {
    return { error: `Keep the category name under ${CATEGORY_NAME_MAX} characters.` };
  }
  const id = slugifyCategoryName(trimmed);
  if (!id) {
    return { error: "A category name needs at least one letter or number." };
  }
  if (existing.some((c) => c.id === id)) {
    return { error: `There's already a "${trimmed}" category.` };
  }
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    return { error: "Pick a colour, or type a hex value like #c98a2c." };
  }
  return { id, name: trimmed, color: normalized };
}

function toCategoryDoc(id: string, data: DocumentData): CategoryDoc {
  return {
    id,
    name: data.name,
    // Colour is validated on the way in, but a hand-edited doc shouldn't be
    // able to inject anything into a style attribute either.
    color: isValidHexColor(data.color ?? "") ? data.color : FALLBACK_CATEGORY.color,
    builtIn: false,
  };
}

export async function listCategories(): Promise<CategoryDoc[]> {
  const snapshot = await categoriesCollection().get();
  // Sorted in memory rather than with orderBy("name"): Firestore's orderBy
  // silently drops docs missing the field (see docs/knowledge-base.md).
  return mergeCategories(snapshot.docs.map((doc) => toCategoryDoc(doc.id, doc.data())));
}

export async function createCategory(
  name: string,
  color: string,
  createdBy: string,
): Promise<CategoryDoc | { error: string }> {
  const validated = validateNewCategory(name, color, await listCategories());
  if ("error" in validated) {
    return validated;
  }
  await categoriesCollection().doc(validated.id).set({
    name: validated.name,
    color: validated.color,
    createdBy,
    createdAt: Timestamp.now(),
  });
  return { ...validated, builtIn: false };
}

export interface CategoryChip {
  id: string;
  name: string;
  color: string;
  /** Readable text colour for `color` — see contrastInk. */
  ink: string;
}

export function toChip(category: CategoryDoc): CategoryChip {
  return {
    id: category.id,
    name: category.name,
    color: category.color,
    ink: contrastInk(category.color),
  };
}

/**
 * Returns a lookup the templates can call directly, so a view never has to
 * search the category list itself (and never renders a raw, unvalidated
 * colour — every path goes through resolveCategory's fallback).
 */
export function makeChipLookup(
  categories: CategoryDoc[],
): (categoryId: string | null) => CategoryChip {
  return (categoryId) => toChip(resolveCategory(categoryId, categories));
}
