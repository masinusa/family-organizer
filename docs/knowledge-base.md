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

## Guidelines

- Terraform owns the Cloud Run service's shape (ingress, IAP, IAM); GitHub
  Actions only ships new image tags. `lifecycle { ignore_changes =
  [template[0].containers[0].image] }` on the service is what keeps these
  from fighting each other — don't remove it.
- The budget alert is notify-only (email at 50/90/100% of spend), not a
  hard spending cap. Scale-to-zero Cloud Run and no load balancer are what
  actually bound cost.
