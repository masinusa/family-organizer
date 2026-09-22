# Roadmap

- [x] **Infrastructure skeleton** — Terraform for Cloud Run + IAP + Artifact
  Registry + WIF + budget alert; GitHub Actions CI/CD; docs (architecture,
  threat model, ADRs). `app/` is a static placeholder.
- [ ] **Pick the app stack** — write a stack ADR (language/framework/datastore),
  replace the placeholder in `app/` with a real app skeleton, and add auth
  middleware that reads the IAP identity header (`X-Goog-IAP-JWT-Assertion`)
  rather than building any login flow.
- [ ] **Calendar CRUD** — build the shared calendar: create/edit/delete
  events, an attendee list, RSVP.
- [ ] **Notifications and recurrence** — recurring events (RRULE),
  reminders/notifications for upcoming events.
- [x] **Custom domain** — `spicers.family` mapped via Cloud Run Domain
  Mapping (`infra/terraform/domain_mapping.tf`), DNS added at Cloudflare,
  certificate provisioned, and IAP confirmed still fronting the domain
  correctly (redirects to Google login same as the `run.app` URL). See the
  addendum in `docs/adr/0002-gcp-cloud-run-iap.md`, which also documents a
  real gotcha hit along the way: native IAP intercepts the ACME HTTP-01
  challenge Google's cert provisioning needs, so it can stall indefinitely
  unless IAP is briefly disabled to let the cert issue once.
- [x] **Family member administration** — Firestore `users` collection is
  the single source of truth for both app access and IAP access: an admin
  adds a family member (role: admin/member) via `/admin`, which both
  creates their Firestore doc and grants their IAP access directly (ADR
  0006, replacing an earlier Google-Group-based approach). Removing
  someone deletes their doc outright and revokes IAP access to match.
- [ ] **Friendly access-denied page** — a custom `/access-denied` page for
  visitors who sign in with Google but aren't in the family group, via
  IAP's `accessDeniedPageSettings`; needs a manual `gcloud iap settings
  set` step and end-to-end verification against the deployed site with a
  non-member Google account (see `docs/adr/0002-gcp-cloud-run-iap.md`).
