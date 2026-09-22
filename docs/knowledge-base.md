# Knowledge base

A running log for anyone (agent or human) working in this repo. Append,
don't rewrite — newest entry last in each section.

## Pitfalls

- Cloud Run injects `PORT=8080` into the container; nginx's default `listen
  80` will fail health checks. `app/nginx.conf` must explicitly `listen
  8080`.
- **Do not add a `google_iap_brand`/`google_iap_client` resource.** The IAP
  OAuth Admin API they depend on was fully shut down Mar 19, 2026;
  `terraform validate` flags `google_iap_brand` as deprecated and it can no
  longer create anything. There is no Terraform replacement — the OAuth
  consent screen (External audience, auto-generated credentials, since
  family members use personal Gmail accounts, not a Workspace org) must be
  configured once, manually, via Cloud Console before IAP will let anyone
  through. See `docs/adr/0002-gcp-cloud-run-iap.md`. `iap_enabled = true`
  plus the two IAM-member resources in `infra/terraform/iap.tf` are still
  correct and GA — only the consent-screen provisioning moved out of
  Terraform. After any change to that file, manually verify a real
  family-group member can load the Cloud Run URL and gets IAP's login
  prompt — don't trust a clean `apply` alone, since reachability now
  depends on state outside Terraform.
- `google_billing_budget`'s `all_updates_rule` block requires either
  `monitoring_notification_channels` or `pubsub_topic` to be set — it's not
  valid with just `disable_default_iam_recipients`. Simplest fix: omit the
  block entirely; billing account admins still get the default threshold
  emails without it.
- Applying with a *user's* gcloud credentials (not a service account key)
  can fail `google_billing_budget` with `403 ... requires a quota project,
  which is not set by default`, even after `gcloud auth
  application-default set-quota-project`. The ADC file's `quota_project_id`
  isn't respected by every API — `billingbudgets.googleapis.com` billed
  against gcloud's own default OAuth client project (`764086051850`)
  instead. Fix is in `provider.tf`: `user_project_override = true` +
  `billing_project = var.project_id` on the `google` provider block, which
  forces every API call to quota/bill against the target project
  regardless of ADC. Verified working end-to-end on the real project.
- `apis.tf` must include plain `iam.googleapis.com`, not just
  `iamcredentials.googleapis.com` — service accounts and workload identity
  pools need the former. This was masked on the very first `apply` because,
  before the `billing_project` override above was added, those calls were
  incorrectly checking API-enablement against gcloud's own project (which
  has everything enabled), not the target project. Once the override was
  correct, `google_service_account`/`google_iam_workload_identity_pool`
  started failing with `iam.googleapis.com` "not been used in this
  project" until it was added to `local.required_apis` and enabled.
- CodeQL's `javascript` language does **not** silently no-op on a repo with
  zero JS/TS files — it hard-fails the run ("no source code seen during
  build"), confirmed on the very first push. `app/` is static HTML with no
  script, so `.github/workflows/codeql.yml` now scans the `actions`
  language instead (CodeQL's GitHub Actions workflow analysis), which has
  real content to check today. Add the app's real language to the matrix
  once a stack ADR picks one — don't assume an empty-language matrix entry
  is harmless.
- Even after the manual IAP consent-screen setup, the service still
  returned `Empty Google Account OAuth client ID(s)/secret(s)` — the
  console's "Auto-generate credentials" option wasn't offered for this
  project (Sept 2026). Had to create the OAuth client by hand and push it
  to IAP via `gcloud iap settings set`. See the updated
  `docs/adr/0002-gcp-cloud-run-iap.md` and README quick start for the exact
  procedure. The client ID/secret live only in IAP's own settings — never
  in Terraform, never in this repo.
- **Cloud Run Domain Mapping's cert provisioning can stall indefinitely
  behind native IAP.** Google's automatic TLS cert for a domain mapping
  requires a public, unauthenticated ACME HTTP-01 challenge request to
  succeed — but `iap_enabled = true` intercepts that request too (confirmed
  via `curl`: the challenge path got an IAP-generated redirect, not the
  expected 200). Symptom: `gcloud beta run domain-mappings describe` stuck
  on `CertificatePending` with "challenge data was not visible through the
  public internet." Also hit: setting `iap_enabled = false` via Terraform
  `apply` reported success but the live value silently reverted to `true`
  within ~5 minutes with zero other writes in Cloud Audit Logs (a
  suspected provider/API quirk around the `false` zero-value on this
  newer, March-2026-GA'd field — not confirmed, but worth assuming this
  field is unreliable to toggle off/on quickly via Terraform). What
  actually worked: even that brief, imperfectly-controlled window with IAP
  off was enough for the one-time ACME validation to succeed — the cert,
  once issued, doesn't need continued public access to stay valid, so
  don't assume you need `iap_enabled=false` to hold steady for long. See
  the addendum in `docs/adr/0002-gcp-cloud-run-iap.md`.
- **An Eta `<% %>` code block that opens with a bare array/object literal
  (`<% ["a","b"].forEach(...) %>`) can silently break with `Cannot read
  properties of undefined (reading 'forEach')`.** Eta's codegen emits
  `__eta.res+='<preceding text>'` with no trailing semicolon before each
  code block; if any static text precedes the tag (even a single space or
  newline) and the block starts with `[`, JS's automatic-semicolon-insertion
  parses it as `'<preceding text>'["a","b"]` (computed member access on the
  string) instead of two separate statements — the whole `.forEach` then
  runs on `undefined`. Hit this in `app/src/views/calendar.eta`'s weekday
  header loop. Fix: never start a code block with a literal `[`/`(` — assign
  it to a `const` in its own `<% %>` tag first, then iterate the variable
  (identifiers don't trigger ASI merging). Confirmed by diffing
  `eta.compileToString()` output with vs. without leading text — the bug
  reproduces in isolation with zero project-specific code involved.
- **Firestore's `orderBy("field")` silently excludes any document missing
  that field — it doesn't error.** `users-repo.ts`'s `listUsers()` ordered
  by `"email"`, but email is only ever stored as the document ID, never as
  a field, so the query returned zero results even with real docs present
  (`/admin` rendered an empty member list right after a successful seed).
  Fixed by ordering on `FieldPath.documentId()` instead. Caught only by
  manually hitting the running app against the emulator — `npm test`
  wouldn't have caught it, since this repo doesn't run Firestore-backed
  tests against real query behavior.
- **The Admin SDK Directory API cannot manage a consumer Google Group's
  membership at all** — it only works for groups belonging to a Google
  Workspace or Cloud Identity org the caller administers.
  `spicer-familia@googlegroups.com` was a plain group created at
  groups.google.com, not part of any such org (family members sign in with
  personal Gmail, not a Workspace — see ADR 0002). There's no domain-wide
  delegation or service-account trick that gets around this; the group has
  to belong to an org first. Led to ADR 0006: dropped the Group, app now
  grants/revokes `roles/iap.httpsResourceAccessor` per email directly on
  Cloud Run's own IAP resource instead.
- **`https://iap.googleapis.com/v1/{resource}:getIamPolicy` is `POST`, not
  `GET`**, unlike almost every other GCP IAM `getIamPolicy` endpoint — a
  plain `GET` 404s. Confirmed against the live resource with `gcloud iap
  web get-iam-policy --resource-type=cloud-run ... --log-http` before
  relying on it in `app/src/lib/iap-access.ts`; don't assume this one
  follows the usual convention. The resource name accepts either the
  project ID or project number interchangeably
  (`projects/{id-or-number}/iap_web/cloud_run-{region}/services/{name}`) —
  confirmed both work via direct `curl`, though `gcloud`'s own `--log-http`
  output uses the number.

## Decisions

- Chose native Cloud Run IAP over the older load-balancer + Serverless NEG +
  backend-service pattern (see `docs/adr/0002-gcp-cloud-run-iap.md`) —
  simpler and removes a recurring LB cost line, which matters for a
  single-digit-dollars/month budget.
- IAP access is gated by a Google Group (`iap_access_group` variable), not
  individual account bindings, so membership changes don't require a
  `terraform apply`.
- `app/` stays a static placeholder until a stack ADR is written — don't
  infer a framework choice from its current contents.
- `GET /` now renders a month grid (`app/src/views/calendar.eta`) instead
  of the old flat upcoming-events list, which was removed. Events are
  bucketed onto a day cell by `startAt`'s local calendar date only, so a
  multi-day event currently only renders on its start day — no logic
  spans it across the days it covers.
- Added a Firestore `users` collection as an explicit, app-level access
  gate *behind* IAP: doc id is the lowercased email, the only field is
  `role` (`admin`|`member`). Deliberately **no self-provisioning** — being
  in the IAP Google Group only proves someone can complete Google sign-in,
  it does not grant app access. An admin must add a doc via `/admin` (or
  the seed script) before that email can use anything past the health
  check. Removing someone is a real Firestore delete, not a status flag —
  chosen over a soft-delete/tombstone specifically because this repo has
  no self-provisioning to "undo": without it, a soft-delete would add
  complexity for no benefit. The very first `admin` doc has no
  special-casing in code and is seeded once via `npm run seed:admin`,
  idempotent/safely re-runnable as a recovery path; the admin UI refuses
  to demote or delete the last remaining admin to avoid a total lockout.
- **Superseded the Google-Group decision above.** The Firestore `users`
  collection is now the single source of truth for both app access and
  IAP access — `/admin` grants/revokes `roles/iap.httpsResourceAccessor`
  per email directly, no Group involved, no `iap_access_group` variable
  anymore. See ADR 0006 and the Pitfalls entries above for why (a consumer
  Google Group can't be managed by API at all) and how (IAP's own IAM
  policy, not the Admin SDK).

## Guidelines

- Terraform owns the Cloud Run service's shape (ingress, IAP, IAM); GitHub
  Actions only ships new image tags. `lifecycle { ignore_changes =
  [template[0].containers[0].image] }` on the service is what keeps these
  from fighting each other — don't remove it.
- The budget alert is notify-only (email at 50/90/100% of spend), not a
  hard spending cap. Scale-to-zero Cloud Run and no load balancer are what
  actually bound cost.
