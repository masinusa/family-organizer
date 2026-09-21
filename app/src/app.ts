import express from "express";
import { errorHandler } from "./middleware/error-handler.js";
import { iapAuth } from "./middleware/iap-auth.js";
import { healthRouter } from "./routes/health.js";
import { homeRouter } from "./routes/home.js";

export function createApp() {
  const app = express();

  // Unauthenticated: Cloud Run/local liveness checks.
  app.use(healthRouter);

  // Everything else sits behind IAP identity verification.
  app.use(iapAuth);
  app.use(homeRouter);

  app.use(errorHandler);

  return app;
}
