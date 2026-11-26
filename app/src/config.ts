const isProduction = process.env.NODE_ENV === "production";

export const config = {
  port: Number(process.env.PORT) || 8080,
  isProduction,
  /**
   * Together these build the audience string IAP's JWT assertion is
   * verified against: /projects/{number}/locations/{region}/services/{name}.
   * Also used by lib/iap-access.ts to address the IAP web resource whose
   * IAM policy grants/revokes per-user access. Set via Terraform
   * (infra/terraform/cloud_run.tf) in the deployed environment.
   */
  gcpProjectNumber: process.env.GCP_PROJECT_NUMBER ?? "",
  gcpRegion: process.env.GCP_REGION ?? "",
  gcpServiceName: process.env.GCP_SERVICE_NAME ?? "",
  /**
   * Addresses Secret Manager's REST paths (lib/secret-store.ts), which take
   * a project id or number interchangeably. Set explicitly by Terraform in
   * the deployed environment; the dev scripts export GOOGLE_CLOUD_PROJECT
   * instead, which is also what @google-cloud/firestore reads.
   */
  gcpProjectId: process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "",
  /**
   * The shared mailbox a subscription can be registered to. A subscription
   * whose accountEmail matches this is the only kind that offers "Recent
   * mail" — see lib/mailbox.ts. Unset means the feature is off entirely.
   */
  familyMailboxAddress: (process.env.FAMILY_MAILBOX_ADDRESS ?? "").trim().toLowerCase(),
  /**
   * True when we're pointed at the Firestore emulator, i.e. scripts/dev-local.sh.
   * lib/secret-store.ts uses this to pick its in-memory backend: a local run
   * against the emulator has no real GCP project behind it, so a Secret
   * Manager call there would fail rather than no-op. dev-local-real.sh
   * leaves this unset and exercises the real store through ADC.
   */
  usingFirestoreEmulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
  /**
   * Local-dev-only escape hatch: when set (and NODE_ENV !== "production"),
   * requests with no X-Goog-IAP-JWT-Assertion header are treated as this
   * authenticated email instead of being rejected. Never read in production
   * — see middleware/iap-auth.ts.
   */
  devUserEmail: process.env.DEV_USER_EMAIL ?? "",
};
