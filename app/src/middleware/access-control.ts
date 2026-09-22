import type { NextFunction, Request, Response } from "express";
import { render } from "../lib/render.js";
import { usersRepo } from "../lib/users-repo.js";
import type { UserDoc } from "../lib/types.js";

declare module "express-serve-static-core" {
  interface Request {
    appUser?: UserDoc;
  }
}

function forbidden(res: Response, message: string): void {
  res.status(403).send(render("forbidden", { message }));
}

/**
 * Runs immediately after iapAuth. Passing IAP only proves someone's in the
 * family Google Group — it does not grant app access. An admin must have
 * explicitly added a Firestore doc for this email via the /admin page (or
 * the seed script) before they can use anything past this point.
 */
export async function requireFamilyMember(req: Request, res: Response, next: NextFunction): Promise<void> {
  const appUser = await usersRepo.getUser(req.user!.email);
  if (!appUser) {
    forbidden(res, "You don't have access to this site yet. Ask a family admin to add you.");
    return;
  }
  req.appUser = appUser;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.appUser?.role !== "admin") {
    forbidden(res, "You don't have permission to view this page.");
    return;
  }
  next();
}

export function isAdmin(req: Request): boolean {
  return req.appUser?.role === "admin";
}
