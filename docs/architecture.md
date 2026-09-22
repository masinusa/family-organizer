# Architecture

## Overview

```
GitHub Actions (WIF, no keys)
        |  build + push image
        v
Artifact Registry (Docker)
        |  deploy-cloudrun
        v
Cloud Run service "family-hub"  <---- IAP <---- family member's browser
   (ingress: all, iap_enabled)          (Google OAuth; per-user access
        |  runtime SA                    the app itself grants/revokes)
        v
Firestore (events, users)
```

Family members hit `spicers.family`, mapped to the Cloud Run URL via Cloud
Run Domain Mapping (`infra/terraform/domain_mapping.tf`).
Identity-Aware Proxy intercepts every request and requires the caller to
authenticate with a Google account holding `roles/iap.httpsResourceAccessor`
on the service, then forwards a signed identity assertion
(`X-Goog-IAP-JWT-Assertion`) to the app containing the authenticated email.
The app never implements its own login or password store — IAP is the
entire auth boundary.

Who holds that role is managed by the app itself, not a Google Group: the
Firestore `users` collection (below) is the single source of truth for both
"has app access" and "can pass IAP" — adding or removing a family member via
`/admin` grants or revokes their IAP access directly, through
`app/src/lib/iap-access.ts`. One binding stays outside the app's control as
a bootstrap/recovery path (`bootstrap_admin_email` in
`infra/terraform/iap.tf`). See ADR 0006 for why this replaced a Google
Group.

Deploys are decoupled from infrastructure changes: GitHub Actions (via
Workload Identity Federation, no long-lived keys) builds and pushes a new
container image and rolls a new Cloud Run revision on every push to `main`
that touches `app/`. Terraform owns everything else — the service's ingress
settings, IAM bindings, IAP configuration — and explicitly ignores the
deployed image so the two don't fight each other.

## Data model

The product is a single shared family calendar — no per-household or
per-person calendars, no photo storage. Per ADR 0005, the datastore is
Firestore (Native mode), which has no joins/foreign keys, so the shape is
collections/subcollections rather than relational tables:

**`events/{eventId}`** (top-level collection)

| field           | notes                                |
| ---------------- | ------------------------------------- |
| title            |                                        |
| description      | nullable                              |
| startAt          | Timestamp                             |
| endAt            | Timestamp                             |
| allDay           | boolean                               |
| location         | nullable, free text                   |
| recurrenceRule   | nullable (e.g. RRULE string)          |
| createdBy        | email, from the IAP identity header   |
| createdAt        |                                        |
| updatedAt        |                                        |

**`events/{eventId}/attendees/{attendeeId}`** (subcollection)

| field          | notes                                                 |
| --------------- | ------------------------------------------------------ |
| userEmail      | from the IAP identity header                            |
| responseStatus | enum: needs_action / accepted / declined / tentative    |
| isOrganizer    | boolean                                                 |

Attendees are a subcollection rather than an array field on the event so
that an RSVP is a single targeted document write, not a read-modify-write of
the whole attendee list.

**`users/{email}`** (top-level collection, doc ID is the lowercased email)

| field     | notes                                    |
| --------- | ------------------------------------------ |
| role      | enum: admin / member                      |
| createdAt |                                            |
| updatedAt |                                            |

This is the entire identity/authorization system alongside IAP: a doc's
presence is what grants app access, and its existence also drives the
IAP-access grant itself (ADR 0006) — there's no separate credentials table
or external group to keep in sync.
