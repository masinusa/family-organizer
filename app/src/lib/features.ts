/**
 * Who can open which part of the site. Pure — no Firestore, no Express —
 * so the whole access matrix is unit-testable; middleware/feature-access.ts
 * is the thin layer that applies it to every request.
 *
 * Family accounts (admin or member) get every feature. A friend gets only
 * what an admin opted them into, plus whatever they reach by taking part
 * in something (a Secret Santa). And a path no feature claims is family
 * only: the gate fails closed, so a page added later is never visible to
 * a friend by accident.
 */
import type { FeatureKey, UserRole } from "./types.js";

export interface Feature {
  key: FeatureKey;
  label: string;
  /** Where the feature starts — the nav link and a friend's landing page. */
  href: string;
  /** Path prefixes it owns. "/" owns the root only, not everything under it. */
  paths: string[];
  /** In the top nav. Feedback lives in the floating button instead. */
  nav: boolean;
}

export const FEATURES: Feature[] = [
  { key: "calendar", label: "Calendar", href: "/", paths: ["/", "/events", "/categories"], nav: true },
  { key: "family", label: "Family", href: "/family", paths: ["/family"], nav: true },
  { key: "vault", label: "Vault", href: "/subscriptions", paths: ["/subscriptions"], nav: true },
  { key: "feedback", label: "Feedback", href: "/feedback", paths: ["/feedback"], nav: false },
];

export function isFeatureKey(value: unknown): value is FeatureKey {
  return FEATURES.some((feature) => feature.key === value);
}

export function featureByKey(key: FeatureKey): Feature {
  return FEATURES.find((feature) => feature.key === key)!;
}

function owns(prefix: string, path: string): boolean {
  if (prefix === "/") return path === "/";
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Null for a path no feature claims, which the gate treats as family only. */
export function featureForPath(path: string): Feature | null {
  return FEATURES.find((feature) => feature.paths.some((prefix) => owns(prefix, path))) ?? null;
}

export interface FeatureViewer {
  role: UserRole;
  optIns: FeatureKey[];
}

/**
 * What a viewer reaches by taking part rather than by being opted in —
 * worked out per request by the middleware, since it takes a read.
 */
export interface AccessContext {
  participates: ReadonlySet<FeatureKey>;
}

export const NO_PARTICIPATION: AccessContext = { participates: new Set() };

export function isFamily(viewer: { role: UserRole }): boolean {
  return viewer.role !== "friend";
}

export function canUseFeature(viewer: FeatureViewer, key: FeatureKey, ctx: AccessContext): boolean {
  if (isFamily(viewer)) return true;
  return viewer.optIns.includes(key) || ctx.participates.has(key);
}

export function allowedFeatures(viewer: FeatureViewer, ctx: AccessContext): Feature[] {
  return FEATURES.filter((feature) => canUseFeature(viewer, feature.key, ctx));
}

export function canOpenPath(viewer: FeatureViewer, path: string, ctx: AccessContext): boolean {
  const feature = featureForPath(path);
  if (!feature) return isFamily(viewer);
  return canUseFeature(viewer, feature.key, ctx);
}

/**
 * The friend editor's checkboxes: an array, a bare string when one is
 * ticked, or nothing. An unknown key is rejected rather than dropped, since
 * the form only ever offers real ones.
 */
export function parseOptIns(raw: unknown): FeatureKey[] | { error: string } {
  const values = Array.isArray(raw) ? raw : raw === undefined || raw === "" ? [] : [raw];
  const keys: FeatureKey[] = [];
  for (const value of values) {
    if (!isFeatureKey(value)) return { error: "Unknown feature." };
    if (!keys.includes(value)) keys.push(value);
  }
  return keys;
}
