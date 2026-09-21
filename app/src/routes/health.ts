import { Router } from "express";

export const healthRouter = Router();

// Unauthenticated on purpose — not mounted behind iap-auth in app.ts.
healthRouter.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});
