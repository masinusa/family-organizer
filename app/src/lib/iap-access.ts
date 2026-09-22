import { GoogleAuth } from "google-auth-library";
import { config } from "../config.js";

const ACCESSOR_ROLE = "roles/iap.httpsResourceAccessor";

interface Binding {
  role: string;
  members: string[];
}

interface Policy {
  version?: number;
  etag?: string;
  bindings?: Binding[];
}

let auth: GoogleAuth | null = null;

function authClient(): GoogleAuth {
  auth ??= new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  return auth;
}

/**
 * Local dev never has GCP_PROJECT_NUMBER/REGION/SERVICE_NAME set (see
 * scripts/dev-local.sh) — only a real deployment does, via
 * infra/terraform/cloud_run.tf. Grant/revoke become no-ops rather than
 * failing every "add a family member" click against a local Firestore
 * emulator with no real IAP resource behind it.
 */
function isConfigured(): boolean {
  return Boolean(config.gcpProjectNumber && config.gcpRegion && config.gcpServiceName);
}

function resourceName(): string {
  return `projects/${config.gcpProjectNumber}/iap_web/cloud_run-${config.gcpRegion}/services/${config.gcpServiceName}`;
}

// IAP's getIamPolicy is POST, not GET, unlike most other GCP IAM APIs —
// verified against the live resource with `gcloud iap web get-iam-policy
// --log-http` before relying on it here.
async function getPolicy(): Promise<Policy> {
  const client = await authClient().getClient();
  const res = await client.request<Policy>({
    url: `https://iap.googleapis.com/v1/${resourceName()}:getIamPolicy`,
    method: "POST",
  });
  return res.data;
}

async function setPolicy(policy: Policy): Promise<void> {
  const client = await authClient().getClient();
  await client.request({
    url: `https://iap.googleapis.com/v1/${resourceName()}:setIamPolicy`,
    method: "POST",
    data: { policy },
  });
}

/**
 * Grants IAP access to a single email — this is what stands in for adding
 * someone to a Google Group, which can't be managed by API without a
 * Workspace/Cloud Identity org (see docs/adr and threat-model.md). Read-
 * modify-write against the same IAM policy infra/terraform/iap.tf's
 * bootstrap_admin binding lives on, so this must never touch other members.
 */
export async function grantAccess(email: string): Promise<void> {
  if (!isConfigured()) return;
  const policy = await getPolicy();
  const member = `user:${email}`;
  const bindings = policy.bindings ?? [];
  const binding = bindings.find((b) => b.role === ACCESSOR_ROLE);
  if (binding) {
    if (binding.members.includes(member)) return;
    binding.members.push(member);
  } else {
    bindings.push({ role: ACCESSOR_ROLE, members: [member] });
  }
  await setPolicy({ ...policy, bindings });
}

/** Revokes IAP access for a single email. Safe to call for someone who was never granted it. */
export async function revokeAccess(email: string): Promise<void> {
  if (!isConfigured()) return;
  const policy = await getPolicy();
  const member = `user:${email}`;
  const bindings = (policy.bindings ?? [])
    .map((b) => (b.role === ACCESSOR_ROLE ? { ...b, members: b.members.filter((m) => m !== member) } : b))
    .filter((b) => b.members.length > 0);
  await setPolicy({ ...policy, bindings });
}
