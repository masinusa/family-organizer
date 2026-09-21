import type { NextFunction, Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { config } from "../config.js";

const ASSERTION_HEADER = "x-goog-iap-jwt-assertion";
const IAP_ISSUER = "https://cloud.google.com/iap";

export interface AuthenticatedUser {
  email: string;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthenticatedUser;
  }
}

// Exported so tests can stub getIapPublicKeys() without a real network call.
export const oAuth2Client = new OAuth2Client();

function expectedAudience(): string {
  return `/projects/${config.gcpProjectNumber}/locations/${config.gcpRegion}/services/${config.gcpServiceName}`;
}

/**
 * Cloud Run's ingress is set to INGRESS_TRAFFIC_ALL (infra/terraform/cloud_run.tf),
 * so the service is reachable directly, bypassing IAP, unless this middleware
 * cryptographically verifies the assertion rather than trusting the header's
 * mere presence. A missing/invalid/wrong-audience assertion is always a 401.
 */
export async function iapAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const assertion = req.header(ASSERTION_HEADER);

  if (!assertion) {
    if (!config.isProduction && config.devUserEmail) {
      req.user = { email: config.devUserEmail };
      next();
      return;
    }
    res.status(401).send("Missing IAP assertion");
    return;
  }

  try {
    const { pubkeys } = await oAuth2Client.getIapPublicKeys();
    const ticket = await oAuth2Client.verifySignedJwtWithCertsAsync(
      assertion,
      pubkeys,
      expectedAudience(),
      [IAP_ISSUER],
    );
    const payload = ticket.getPayload();
    if (!payload?.email) {
      res.status(401).send("Invalid IAP assertion");
      return;
    }
    req.user = { email: payload.email };
    next();
  } catch {
    res.status(401).send("Invalid IAP assertion");
  }
}
