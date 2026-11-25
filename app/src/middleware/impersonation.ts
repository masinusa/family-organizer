import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { normalizeEmail } from "../lib/email.js";
import { usersRepo } from "../lib/users-repo.js";
import type { UserDoc } from "../lib/types.js";

/**
 * Admin-only "view the site as somebody else", so a change can be checked
 * from a member's perspective without keeping a second Google account
 * around.
 *
 * The cookie is deliberately unsigned: all it carries is *who* to become,
 * and it is only ever honoured after the IAP-verified identity has been
 * looked up in Firestore and found to be an admin. Forging it therefore
 * buys nothing — a non-admin who sets it by hand just gets it deleted on
 * the next request.
 */
export const IMPERSONATION_COOKIE = "view-as";

declare module "express-serve-static-core" {
  interface Request {
    /**
     * Set only while impersonating: the admin actually signed in. When
     * it is set, `req.user` is the *pretend* identity, and everything
     * downstream — authorization included — sees that one instead.
     */
    impersonator?: UserDoc;
  }
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: config.isProduction,
  path: "/",
} as const;

/** express can set cookies on its own; reading one needs this much. */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function startImpersonating(res: Response, email: string): void {
  res.cookie(IMPERSONATION_COOKIE, normalizeEmail(email), COOKIE_OPTIONS);
}

export function stopImpersonating(res: Response): void {
  res.clearCookie(IMPERSONATION_COOKIE, COOKIE_OPTIONS);
}

/** The Google account actually signed in, whoever is being impersonated. */
export function realEmail(req: Request): string {
  return req.impersonator?.email ?? normalizeEmail(req.user!.email);
}

/**
 * Sits between iapAuth and requireFamilyMember. Rewriting `req.user` here
 * rather than threading a second identity through every route is the whole
 * point: the pretend identity passes through the app's own authorization
 * layer too, so an admin viewing as a member really is refused the admin
 * pages instead of merely seeing a different name in the corner.
 *
 * A cookie naming an account that no longer exists is left in place and
 * 403s at requireFamilyMember — the banner's "Back to me" is mounted ahead
 * of that check, so it is never a dead end.
 */
export async function applyImpersonation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const target = readCookie(req, IMPERSONATION_COOKIE);
  if (!target) {
    next();
    return;
  }

  const real = await usersRepo.getUser(req.user!.email);
  if (real?.role !== "admin" || normalizeEmail(target) === real.email) {
    // Not an admin (or no longer one), or pointed at themselves: drop the
    // cookie rather than carry a no-op around on every request.
    stopImpersonating(res);
    next();
    return;
  }

  req.impersonator = real;
  req.user = { email: normalizeEmail(target) };
  next();
}

/**
 * Authorization for the impersonation controls themselves always follows
 * the real Google account, never the impersonated one — otherwise viewing
 * as a member would take away the very control that gets you back.
 */
export async function realAdmin(req: Request): Promise<UserDoc | null> {
  if (req.impersonator) return req.impersonator;
  const user = await usersRepo.getUser(req.user!.email);
  return user?.role === "admin" ? user : null;
}

/**
 * The two bits views/layout.eta needs for the banner and the picker.
 * `path` is where those forms send the reader back to, so it is only a
 * real path on a GET — a rendered-in-place POST response has nowhere
 * safe to return to.
 */
export function impersonationState(req: Request): { impersonator: string | null; path: string } {
  return {
    impersonator: req.impersonator?.email ?? null,
    path: req.method === "GET" ? req.originalUrl : "/",
  };
}
