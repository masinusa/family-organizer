# ADR 0005: App stack is Node.js/TypeScript on Express, data stored in Firestore

## Status

Accepted

## Context

`app/` is still the static nginx placeholder from Phase 0. Per `AGENTS.md`, no
framework or dependency may be added to it without an ADR. The calendar
feature (`docs/roadmap.md`'s "Calendar CRUD" item) can't start until a real
app stack and datastore are chosen.

Constraints on the choice:

- Must run in the existing `family-hub` Cloud Run container and listen on
  port 8080 (`infra/terraform/cloud_run.tf`).
- Must read the IAP identity assertion (`X-Goog-IAP-JWT-Assertion`) rather
  than implement any login/password flow — IAP is the entire auth boundary
  (`docs/adr/0002-gcp-cloud-run-iap.md`).
- Must fit a $5/month budget alert (`infra/terraform/budget.tf`,
  `var.budget_amount_usd = 5`). This rules out an always-on datastore VM:
  even the smallest Cloud SQL instance bills hourly regardless of traffic,
  which alone can approach the budget. Cloud Run itself scales to zero with
  no traffic, so the datastore should have the same cost shape.
- `AGENTS.md` favors keeping `app/` minimal — no more moving parts than the
  feature needs.

## Decision

- **Language/framework: Node.js + TypeScript + Express**, with
  server-rendered HTML templates (no SPA, no client-side bundler/build
  step). Broad ecosystem support for both Firestore and IAP-JWT
  verification, and avoids adding a frontend build pipeline to a project
  that's deliberately minimal.
- **Datastore: Firestore, Native mode**, same GCP project/region as the
  Cloud Run service. Pay-per-operation/storage pricing with a perpetual free
  tier pairs with Cloud Run's scale-to-zero model far better than an
  always-on Cloud SQL instance, and a family calendar's read/write volume is
  well within Firestore's free tier.

## Consequences

- `docs/architecture.md`'s "Data model" section, written before a datastore
  was chosen, described a relational `events`/`attendees` shape with a
  foreign key. Firestore has no joins/FKs, so `attendees` becomes a
  subcollection of `events/{eventId}` instead of a table with `event_id` —
  updated in that doc alongside this ADR.
- CI currently has no build/test step at all (`deploy.yml` goes straight
  from checkout to `docker build`) — a Node install/test/build step is
  needed before the Docker build step.
- CodeQL's language matrix (`codeql.yml`) currently scans `actions` only
  (there was no application code to scan) — needs `javascript-typescript`
  added.
- Firestore requires `firestore.googleapis.com` enabled and a
  `roles/datastore.user` grant for the `family-hub-runtime` service account
  — new Terraform resources, not yet present.
- No relational transactions/joins are available — multi-document
  consistency (e.g. creating an event and its organizer's attendee record
  together) uses Firestore batched writes instead.
