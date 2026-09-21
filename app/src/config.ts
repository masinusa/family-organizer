const isProduction = process.env.NODE_ENV === "production";

export const config = {
  port: Number(process.env.PORT) || 8080,
  isProduction,
  /**
   * Together these build the audience string IAP's JWT assertion is
   * verified against: /projects/{number}/locations/{region}/services/{name}.
   * Set via Terraform (infra/terraform/cloud_run.tf) in the deployed
   * environment.
   */
  gcpProjectNumber: process.env.GCP_PROJECT_NUMBER ?? "",
  gcpRegion: process.env.GCP_REGION ?? "",
  gcpServiceName: process.env.GCP_SERVICE_NAME ?? "",
  /**
   * Local-dev-only escape hatch: when set (and NODE_ENV !== "production"),
   * requests with no X-Goog-IAP-JWT-Assertion header are treated as this
   * authenticated email instead of being rejected. Never read in production
   * — see middleware/iap-auth.ts.
   */
  devUserEmail: process.env.DEV_USER_EMAIL ?? "",
};
