import express from "express";
import { fileURLToPath } from "node:url";
import { errorHandler } from "./middleware/error-handler.js";
import { iapAuth } from "./middleware/iap-auth.js";
import { requireFamilyMember } from "./middleware/access-control.js";
import { accessDeniedRouter } from "./routes/access-denied.js";
import { categoriesRouter } from "./routes/categories.js";
import { eventsRouter } from "./routes/events.js";
import { familyRouter } from "./routes/family.js";
import { feedbackRouter } from "./routes/feedback.js";
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
  app.use(categoriesRouter);
  // Replaces the old adminRouter: /family is both the tree and the place
  // family members and their accounts are managed.
  app.use(familyRouter);
  app.use(feedbackRouter);

  app.use(errorHandler);

  return app;
}
