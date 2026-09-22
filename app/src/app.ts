import express from "express";
import { fileURLToPath } from "node:url";
import { errorHandler } from "./middleware/error-handler.js";
import { iapAuth } from "./middleware/iap-auth.js";
import { eventsRouter } from "./routes/events.js";
import { healthRouter } from "./routes/health.js";
import { rsvpRouter } from "./routes/rsvp.js";

export function createApp() {
  const app = express();
  const publicDir = fileURLToPath(new URL("./public/", import.meta.url));

  app.use(express.urlencoded({ extended: false }));

  // Unauthenticated: Cloud Run/local liveness checks.
  app.use(healthRouter);

  // Everything else sits behind IAP identity verification.
  app.use(iapAuth);
  app.use(express.static(publicDir));
  app.use(eventsRouter);
  app.use(rsvpRouter);

  app.use(errorHandler);

  return app;
}
