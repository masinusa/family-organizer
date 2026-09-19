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
   (ingress: all, iap_enabled)          (Google OAuth via the family
        |  runtime SA                    Google Group)
        v
(future) datastore for events/attendees
```

Family members hit the Cloud Run URL directly (no custom domain yet).
Identity-Aware Proxy intercepts every request, requires the caller to
authenticate with a Google account that's a member of the IAP access group,
and forwards a signed identity assertion (`X-Goog-IAP-JWT-Assertion`) to the
app containing the authenticated email. The app never implements its own
login or password store — IAP is the entire auth boundary.

Deploys are decoupled from infrastructure changes: GitHub Actions (via
Workload Identity Federation, no long-lived keys) builds and pushes a new
container image and rolls a new Cloud Run revision on every push to `main`
that touches `app/`. Terraform owns everything else — the service's ingress
settings, IAM bindings, IAP configuration — and explicitly ignores the
deployed image so the two don't fight each other.

## Data model

The product is a single shared family calendar — no per-household or
per-person calendars, no photo storage. Once a real datastore is chosen
(Phase 1 stack ADR), the model is expected to be:

**`events`**

| column           | notes                                |
| ---------------- | ------------------------------------- |
| id               | primary key                           |
| title            |                                        |
| description      | nullable                              |
| start_at         |                                        |
| end_at           |                                        |
| all_day          | boolean                               |
| location         | nullable, free text                   |
| recurrence_rule  | nullable (e.g. RRULE string)          |
| created_by       | email, from the IAP identity header   |
| created_at       |                                        |
| updated_at       |                                        |

**`attendees`**

| column          | notes                                                 |
| --------------- | ------------------------------------------------------ |
| event_id        | FK -> events.id                                        |
| user_email      | from the IAP identity header                            |
| response_status | enum: needs_action / accepted / declined / tentative    |
| is_organizer    | boolean                                                 |

No `users` or credentials table is needed — IAP plus the family Google Group
are the entire identity system.
