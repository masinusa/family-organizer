import type { NextFunction, Request, Response } from "express";
import { render } from "../lib/render.js";
import { usersRepo } from "../lib/users-repo.js";
import { impersonationState } from "./impersonation.js";
import type { UserDoc } from "../lib/types.js";

declare module "express-serve-static-core" {
  interface Request {
    appUser?: UserDoc;
  }
}

/**
 * Carries the impersonation banner, because an admin viewing as a member
 * hitting an admin-only page is the single most likely way to land here —
 * and without the banner's "Back to me" the only way out would be
 * clearing cookies by hand.
 */
function forbidden(req: Request, res: Response, message: string): void {
  const { impersonator, path } = impersonationState(req);
  res.status(403).send(render("forbidden", {
    message,
    impersonator,
    path,
    canImpersonate: impersonator !== null,
  }));
}

/**
 * Runs immediately after iapAuth. Passing IAP only proves Google let them
 * to the door — it does not grant app access. An admin must have
 * explicitly added a Firestore doc for this email (via a person's page or
 * /family/accounts, or the seed script) before they can use anything past
 * this point.
 */
export async function requireFamilyMember(req: Request, res: Response, next: NextFunction): Promise<void> {
  const appUser = await usersRepo.getUser(req.user!.email);
  if (!appUser) {
    forbidden(req, res, "You don't have access to this site yet. Ask a family admin to add you.");
    return;
  }
  req.appUser = appUser;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.appUser?.role !== "admin") {
    forbidden(req, res, "You don't have permission to view this page.");
    return;
  }
  next();
}

export function isAdmin(req: Request): boolean {
  return req.appUser?.role === "admin";
}
