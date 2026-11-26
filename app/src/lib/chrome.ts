import type { Request } from "express";
import { isAdmin } from "../middleware/access-control.js";
import { impersonationState } from "../middleware/impersonation.js";

/**
 * Everything views/layout.eta needs for the top bar, in one place. Four
 * routers each had their own copy of `{ email, isAdmin, active }`; the
 * impersonation banner added a fifth field that has to stay in step
 * across all of them, which is one copy too many.
 *
 * `email` is the *effective* identity, so while impersonating the whole
 * page renders as that person — which is the point of it.
 */
export function chrome(req: Request, active: string | null): Record<string, unknown> {
  const { impersonator, path } = impersonationState(req);
  return {
    email: req.user?.email,
    /** Who the page is for, drawn with the persona partials. */
    viewer: req.persona!,
    impersonatorPersona: impersonator ? req.personas!.forEmail(impersonator) : null,
    isAdmin: isAdmin(req),
    /** The top nav: only what this viewer may open (lib/features.ts). */
    nav: req.features!.filter((feature) => feature.nav),
    canFeedback: req.features!.some((feature) => feature.key === "feedback"),
    active,
    impersonator,
    /**
     * Follows the real account's role, not the impersonated one's: the
     * control that ends impersonation cannot be the first casualty of
     * starting it.
     */
    canImpersonate: impersonator !== null || isAdmin(req),
    path,
  };
}
