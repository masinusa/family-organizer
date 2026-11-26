import { GoogleAuth } from "google-auth-library";
import { config } from "../config.js";

const API_BASE = "https://secretmanager.googleapis.com/v1";

interface AccessResponse {
  payload?: { data?: string };
}

interface AddVersionResponse {
  /** projects/{p}/secrets/{s}/versions/{n} — only the last segment is of interest. */
  name?: string;
}

/** Addresses the newest version, whatever its number: Secret Manager's own alias. */
export const LATEST_VERSION = "latest";

let auth: GoogleAuth | null = null;

function authClient(): GoogleAuth {
  auth ??= new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  return auth;
}

/**
 * The real store needs a project *and* a real GCP backend. Under
 * scripts/dev-local.sh both the Firestore emulator and a throwaway project
 * id are in play, so calls would fail outright rather than no-op the way
 * iap-access.ts can afford to — a password feature that silently does
 * nothing is worse than one that is visibly fake. Hence a live in-memory
 * backend for that case instead.
 */
export function usingRealSecretManager(): boolean {
  return Boolean(config.gcpProjectId) && !config.usingFirestoreEmulator;
}

/**
 * Derived from the Firestore doc id rather than stored alongside it, so
 * there's no second name to drift out of sync. Firestore auto-ids are 20
 * chars of [A-Za-z0-9], always within Secret Manager's [a-zA-Z0-9_-]{1,255}.
 */
export function subscriptionSecretId(subscriptionId: string): string {
  return `sub-${subscriptionId}`;
}

/** Secret Manager carries bytes; everything here is a UTF-8 string. */
export function encodePayload(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

export function decodePayload(data: string): string {
  return Buffer.from(data, "base64").toString("utf8");
}

/* ------------------------- in-memory backend ------------------------- */

/**
 * Versions, not a single value, so the password history is clickable under
 * scripts/dev-local.sh too — a history that only works against a real
 * project would go untested until production.
 */
const memoryStore = new Map<string, string[]>();
let warned = false;

function warnOnce(): void {
  if (warned) return;
  warned = true;
  console.warn(
    "Secret Manager is not configured (emulator or no project id) — storing subscription passwords in memory for this process only.",
  );
}

/* --------------------------- REST backend --------------------------- */

function secretPath(secretId: string): string {
  return `${API_BASE}/projects/${config.gcpProjectId}/secrets/${secretId}`;
}

/**
 * Callers only ever pass "latest" or a version this app recorded itself, so
 * this is encoded rather than validated — it must never reach the URL raw.
 */
function versionPath(secretId: string, version: string): string {
  return `${secretPath(secretId)}/versions/${encodeURIComponent(version)}`;
}

/** "projects/p/secrets/s/versions/4" -> "4". */
function versionIdFromName(name: string | undefined): string {
  const id = name?.split("/").pop();
  if (!id) throw new Error("Secret Manager returned a version with no name.");
  return id;
}

/**
 * Only the HTTP status matters here, and google-auth-library doesn't
 * re-export Gaxios's error type — so match the shape rather than import it.
 */
function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | null)?.response?.status;
}

async function createSecret(secretId: string): Promise<void> {
  const client = await authClient().getClient();
  try {
    await client.request({
      url: `${API_BASE}/projects/${config.gcpProjectId}/secrets?secretId=${encodeURIComponent(secretId)}`,
      method: "POST",
      data: { replication: { automatic: {} } },
    });
  } catch (err) {
    // 409 means a previous setPassword already created the container; adding
    // a new version to it is exactly what we want next.
    if (statusOf(err) !== 409) throw err;
  }
}

/* ----------------------------- the API ----------------------------- */

/**
 * Creates the secret if needed, then adds a new version and returns its id.
 * Nothing is overwritten: the previous version stays readable through
 * getSecretVersion, which is what the password history on a subscription's
 * page is built from. The caller records the returned id against whoever
 * saved it — Secret Manager knows when a version landed but not who asked.
 */
export async function setSecret(secretId: string, value: string): Promise<string> {
  if (!usingRealSecretManager()) {
    warnOnce();
    const versions = memoryStore.get(secretId) ?? [];
    versions.push(value);
    memoryStore.set(secretId, versions);
    // Secret Manager numbers versions from 1, so the array index won't do.
    return String(versions.length);
  }
  await createSecret(secretId);
  const client = await authClient().getClient();
  const res = await client.request<AddVersionResponse>({
    url: `${secretPath(secretId)}:addVersion`,
    method: "POST",
    data: { payload: { data: encodePayload(value) } },
  });
  return versionIdFromName(res.data.name);
}

/**
 * Null when the secret, or that version of it, can't be read — "no password
 * there", not an error. `version` is "latest" or a version id this app
 * recorded when it saved the value.
 */
export async function getSecretVersion(
  secretId: string,
  version: string = LATEST_VERSION,
): Promise<string | null> {
  if (!usingRealSecretManager()) {
    warnOnce();
    const versions = memoryStore.get(secretId);
    if (!versions?.length) return null;
    if (version === LATEST_VERSION) return versions[versions.length - 1]!;
    const index = Number(version);
    return Number.isInteger(index) ? (versions[index - 1] ?? null) : null;
  }
  const client = await authClient().getClient();
  try {
    const res = await client.request<AccessResponse>({
      url: `${versionPath(secretId, version)}:access`,
      method: "GET",
    });
    const data = res.data.payload?.data;
    return typeof data === "string" ? decodePayload(data) : null;
  } catch (err) {
    // 404: no such secret or version. 400: FAILED_PRECONDITION, which is what
    // accessing a disabled or destroyed version returns — for a reader that's
    // the same answer as "it isn't there", not a fault to propagate.
    const status = statusOf(err);
    if (status === 404 || status === 400) return null;
    throw err;
  }
}

/** Null when no secret or no version exists — "no password set", not an error. */
export async function getSecret(secretId: string): Promise<string | null> {
  return getSecretVersion(secretId, LATEST_VERSION);
}

/** Deletes the secret and every version. Safe to call when it was never created. */
export async function deleteSecret(secretId: string): Promise<void> {
  if (!usingRealSecretManager()) {
    warnOnce();
    memoryStore.delete(secretId);
    return;
  }
  const client = await authClient().getClient();
  try {
    await client.request({ url: secretPath(secretId), method: "DELETE" });
  } catch (err) {
    if (statusOf(err) !== 404) throw err;
  }
}

/**
 * Object form so tests can stub a method — ES module named exports are
 * frozen bindings that t.mock.method can't redefine, the same reason
 * users-repo.ts and iap-auth.ts export one.
 */
export const secretStore = { setSecret, getSecret, getSecretVersion, deleteSecret };
