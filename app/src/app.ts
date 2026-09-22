import express from "express";
import { fileURLToPath } from "node:url";
import { errorHandler } from "./middleware/error-handler.js";
import { iapAuth } from "./middleware/iap-auth.js";
import { requireFamilyMember } from "./middleware/access-control.js";
import { accessDeniedRouter } from "./routes/access-denied.js";
import { adminRouter } from "./routes/admin.js";
import { eventsRouter } from "./routes/events.js";
import { healthRouter } from "./routes/health.js";

export function createApp() {
  const app = express();
  const publicDir = fileURLToPath(new URL("./public/", import.meta.url));

  app.use(express.urlencoded({ extended: false }));

  // Unauthenticated: Cloud Run/local liveness checks.
  app.use(healthRouter);
  // Unauthenticated: IAP redirects signed-in-but-unauthorized visitors here.
  app.use(accessDeniedRouter);

  // Everything else sits behind IAP identity verification.
  app.use(iapAuth);
  // ...then the app's own Firestore-backed authorization layer.
  app.use(requireFamilyMember);
  app.use(express.static(publicDir));
  app.use(eventsRouter);
  app.use(adminRouter);

  app.use(errorHandler);

  return app;
}
