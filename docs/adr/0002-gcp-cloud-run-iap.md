# ADR 0002: Cloud Run secured by native Identity-Aware Proxy

## Status

Accepted (superseded the OAuth-client-provisioning part of the original
decision — see Consequences)

## Context

The app needs to be reachable only by family members, with no
application-level login system. Two architectures were considered for
fronting Cloud Run with IAP:

1. **Load balancer + Serverless NEG + IAP on the backend service** — the
   long-standing, still-GA pattern: reserve a static IP, provision a
   Google-managed SSL certificate, wire up a URL map / target HTTPS proxy /
   forwarding rule, point a Serverless NEG backend service at Cloud Run, and
   enable IAP on that backend service.
2. **Native IAP directly on the Cloud Run service** (`iap_enabled = true`
   on `google_cloud_run_v2_service`) — reached general availability in
   March 2026, with GA support in the standard `hashicorp/google` Terraform
   provider (`iap_enabled`, `google_iap_web_cloud_run_service_iam_member`).
   No load balancer, static IP, or managed certificate required.

## Decision

Use native Cloud Run IAP (option 2).

Rationale:

- Removes six resource types (reserved IP, managed cert, URL map,
  target-HTTPS-proxy, forwarding rule, Serverless NEG + backend service)
  and the load balancer's own recurring cost — meaningful for a
  single-digit-dollars/month budget target.
- Fewer moving parts: the whole IAP setup is `iap_enabled = true` on the
  service, an invoker binding for the IAP service agent, and an access
  binding for the family group.

## Consequences

- **The OAuth consent screen cannot be Terraform-managed at all**, by
  either architecture. `google_iap_brand`/`google_iap_client` — the
  resources that used to provision it — depended on the IAP OAuth Admin
  API, which was deprecated Jan 22, 2025 and fully shut down Mar 19, 2026.
  `terraform validate` confirms `google_iap_brand` is now flagged
  deprecated by the provider itself. There is no Terraform replacement:
  Google's guidance is to configure the consent screen once, manually, via
  Cloud Console (for this project's case — family members on personal
  Gmail accounts, not a Workspace org — select "External" audience).
  **Verified in practice (Sept 2026):** the console's "Auto-generate
  credentials" option was not offered for this project, so the OAuth
  client had to be created by hand (Google Auth Platform → Clients → Web
  application), with the IAP redirect URI
  (`https://iap.googleapis.com/v1/oauth/clientIds/CLIENT_ID:handleRedirect`)
  added once the client ID existed. The resulting client ID/secret are
  **not stored in Terraform or this repo** — they're handed to IAP
  directly via `gcloud iap settings set <file> --resource-type=cloud-run
  --region=<region> --service=<service>` from a local, never-committed
  YAML file, deleted immediately after. This is now the documented
  procedure in the README quick start, done once per project, before
  `iap` bindings have any effect. `infra/terraform/iap.tf` has a comment
  explaining this and pointing back here.
- `google_cloud_run_v2_service_iam_member`/`google_iap_web_cloud_run_service_iam_member`
  remain GA and Terraform-managed as before — only the consent-screen
  provisioning step moved out of Terraform.
- No custom domain decision is made here — using the default `run.app`
  URL. Adding a custom domain later (`docs/roadmap.md` Phase 4) may require
  revisiting this ADR, since domain-mapped Cloud Run's interaction with
  native IAP should be re-verified.
- After any change to `infra/terraform/iap.tf`, manually verify a real
  family-group member can load the URL and gets IAP's login prompt — don't
  trust a clean `terraform apply` alone, since IAP's actual reachability
  now depends on state outside Terraform (the manual consent screen).
  Logged in `docs/knowledge-base.md`.
