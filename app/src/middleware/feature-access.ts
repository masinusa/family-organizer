import type { NextFunction, Request, Response } from "express";
import {
  allowedFeatures,
  canOpenPath,
  NO_PARTICIPATION,
  type AccessContext,
  type Feature,
} from "../lib/features.js";
import { forbidden } from "./access-control.js";

declare module "express-serve-static-core" {
  interface Request {
    /** What the (effective) viewer may open — the nav is drawn from this. */
    features?: Feature[];
  }
}

/**
 * What a viewer reaches by taking part rather than by being opted in. No
 * feature grants access that way yet; family get everything regardless,
 * so only a friend's request will ever pay for working it out.
 */
async function participation(_req: Request): Promise<AccessContext> {
  return NO_PARTICIPATION;
}

/**
 * Runs after loadPersonas, ahead of every feature router: the one place
 * that decides whether this viewer may open this path at all. Routes still
 * make their own per-record checks (which subscription, which exchange) —
 * this only answers "can they be in this part of the site".
 *
 * A friend who lands on "/" without the calendar is sent to the first
 * thing they can open instead, since "/" is where every link to the site
 * points.
 */
export async function requireFeatureAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const viewer = req.appUser!;
    const ctx = await participation(req);
    req.features = allowedFeatures(viewer, ctx);

    if (canOpenPath(viewer, req.path, ctx)) {
      next();
      return;
    }

    const landing = req.features.find((feature) => feature.nav) ?? req.features[0];
    if (req.method === "GET" && req.path === "/" && landing) {
      res.redirect(landing.href);
      return;
    }
    forbidden(
      req,
      res,
      landing ? "This part of the site isn't shared with you." : "Nothing here has been shared with you yet.",
    );
  } catch (err) {
    next(err);
  }
}
