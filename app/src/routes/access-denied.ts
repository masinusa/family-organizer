import { Router } from "express";
import { render } from "../lib/render.js";

export const accessDeniedRouter = Router();

// Unauthenticated on purpose — not mounted behind iap-auth in app.ts.
// IAP itself redirects here for a signed-in-but-not-in-the-family-group
// visitor, via applicationSettings.accessDeniedPageSettings (see README).
accessDeniedRouter.get("/access-denied", (_req, res) => {
  res.send(render("access-denied"));
});
