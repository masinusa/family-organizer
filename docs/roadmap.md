# Roadmap

## Phase 0 — Infrastructure skeleton (current)

Terraform for Cloud Run + IAP + Artifact Registry + WIF + budget alert;
GitHub Actions CI/CD; docs (architecture, threat model, ADRs). `app/` is a
static placeholder.

## Phase 1 — Pick the app stack

Write a stack ADR (language/framework/datastore) and replace the
placeholder in `app/` with a real app skeleton. Implement an auth middleware
that reads the IAP identity header (`X-Goog-IAP-JWT-Assertion`) rather than
building any login flow.

## Phase 2 — Calendar CRUD

Build the actual shared calendar: create/edit/delete events, an attendee
list, RSVP.

## Phase 3 — Notifications and recurrence

Recurring events (RRULE), reminders/notifications for upcoming events.

## Phase 4 — Custom domain

Map a real domain to the Cloud Run service. **Flag:** domain mapping changes
how IAP is fronted — revisit `docs/adr/0002-gcp-cloud-run-iap.md` and
re-verify access still works end-to-end before shipping this.
