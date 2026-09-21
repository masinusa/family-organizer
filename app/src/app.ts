import express from "express";
import { errorHandler } from "./middleware/error-handler.js";
import { iapAuth } from "./middleware/iap-auth.js";
import { eventsRouter } from "./routes/events.js";
import { healthRouter } from "./routes/health.js";
import { rsvpRouter } from "./routes/rsvp.js";

export function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  // Unauthenticated: Cloud Run/local liveness checks.
  app.use(healthRouter);

  // Everything else sits behind IAP identity verification.
  app.use(iapAuth);
  app.use(eventsRouter);
  app.use(rsvpRouter);

  app.use(errorHandler);

  return app;
}
