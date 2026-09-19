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
