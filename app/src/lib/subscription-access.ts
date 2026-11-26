import { normalizeEmail } from "./email.js";
import type { SubscriptionDoc, UserRole } from "./types.js";

export interface Viewer {
  email: string;
  role: UserRole;
}

/**
 * Admins see every subscription so they can manage them; everyone else sees
 * only the ones they're actually on. Both sides of the comparison are
 * normalized — `memberEmails` is stored normalized, but a viewer's email
 * arrives from the IAP assertion, which doesn't promise casing.
 */
export function canView(viewer: Viewer, subscription: SubscriptionDoc): boolean {
  if (viewer.role === "admin") return true;
  return subscription.memberEmails.includes(normalizeEmail(viewer.email));
}

export function visibleTo(viewer: Viewer, subscriptions: SubscriptionDoc[]): SubscriptionDoc[] {
  return subscriptions.filter((subscription) => canView(viewer, subscription));
}
