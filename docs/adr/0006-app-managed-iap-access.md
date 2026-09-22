# ADR 0006: App-managed per-user IAP access, not a Google Group

## Status

Accepted

## Context

Until now, who could pass IAP's login prompt (`roles/iap.httpsResourceAccessor`)
was controlled by a single Terraform-managed binding granting access to a
Google Group (`spicer-familia@googlegroups.com`), separate from the
Firestore `users` collection that controls access *inside* the app
(ADR-less, but see `docs/threat-model.md`). Adding a family member was a
two-step, two-place process: add them to the app via `/admin`, and
separately add them to the Group by hand in the Google Groups UI — easy to
do one and forget the other, which is exactly what happened in practice
(a family member showed up in the Group but never in the app's list).

The obvious fix — have the app's "add a family member" form also add them
to the Group via API — turned out not to be available here. The Admin SDK
Directory API (the only API that manages Google Group membership) only
works for groups that belong to a Google Workspace or Cloud Identity
organization the caller administers. `spicer-familia@googlegroups.com` is
a plain consumer group created at groups.google.com; family members sign
in with personal Gmail accounts, not a Workspace org (see ADR 0002 and
`docs/knowledge-base.md`). There is no API path to manage a consumer
group's membership at all.

Two real options remained:

1. **Stand up Cloud Identity Free** (free, domain-verified, up to 50 org
   users) for `spicers.family`, move the group under it, and use domain-wide
   delegation + the Admin SDK Directory API from there. Members could stay
   external Gmail addresses. Rejected: ongoing administrative surface (a
   domain-wide-delegation-capable service account, a Workspace/Cloud
   Identity super admin, its own settings to maintain) just to keep a
   middleman that's otherwise removable, and the 50-user ceiling is a bad
   fit for a site expected to grow past that.
2. **Drop the Group entirely; the app grants/revokes IAP access per email
   directly**, via the Cloud Run service's own IAM policy (the same
   `roles/iap.httpsResourceAccessor` binding the Group used to hold, just
   one member at a time instead of via a group). No Workspace/Cloud
   Identity needed — this is a plain GCP IAM operation.

## Decision

Go with option 2. The Firestore `users` collection is now the single
source of truth for both "has app access" and "can pass IAP" —
`createUser`/`deleteUser` (`app/src/lib/users-repo.ts`) call
`app/src/lib/iap-access.ts`, which does a read-modify-write on the IAP web
resource's IAM policy (`iap.webServices.{get,set}IamPolicy` via
`https://iap.googleapis.com/v1/{resource}:{get,set}IamPolicy` — note
`getIamPolicy` is `POST`, not `GET`, unlike most GCP IAM APIs; verified
against the live resource with `gcloud iap web get-iam-policy --log-http`
before relying on it in code).

This requires the runtime service account to be able to edit IAM policy on
its own IAP resource — a real expansion of what that account can do in
production. Scoped to the minimum via a custom role
(`google_project_iam_custom_role.iap_access_manager`,
`infra/terraform/iap.tf`) with only
`iap.web{Services,ServiceVersions}.{get,set}IamPolicy`, rather than the
predefined `roles/iap.admin`, which also bundles in TCP-tunnel IAM
permissions this app never uses.

A single Terraform-managed binding remains: `bootstrap_admin_email` always
gets `roles/iap.httpsResourceAccessor` directly, independent of the app's
own IAM writes — the recovery path if the dynamic IAM code ever breaks or
locks everyone out, mirroring `scripts/seed-admin.ts`'s role on the
Firestore side.

## Consequences

- `iap_access_group` (the Terraform variable) and the Google Group itself
  are no longer part of the access-control system. The group can be
  deleted once this is deployed and verified; nothing in this repo
  references it anymore.
- Granting/revoking IAP access is now attempted from `createUser`/
  `deleteUser` and, deliberately, never throws — a failure is logged
  (`console.error`) but doesn't fail the Firestore write, which remains
  the record the rest of the app (`requireFamilyMember`) actually checks.
  A family member added while this IAM call is failing gets an app-access
  doc but may not be able to get past IAP's login prompt until it's
  retried; there's no user-facing warning for this yet.
- Local dev and tests never set `GCP_PROJECT_NUMBER`/`GCP_REGION`/
  `GCP_SERVICE_NAME` (see `scripts/dev-local.sh`), so `iap-access.ts`
  no-ops there rather than making real API calls against a Firestore
  emulator with no real IAP resource behind it.
- Anyone who only ever had access via the old Group (never added to
  Firestore) loses even the ability to pass IAP once the Group binding is
  removed — no functional change from their perspective, since
  `requireFamilyMember` already blocked them from the app itself.
