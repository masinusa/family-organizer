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
- [ ] **Custom domain** — map a real domain to the Cloud Run service.
  **Flag:** domain mapping changes how IAP is fronted — revisit
  `docs/adr/0002-gcp-cloud-run-iap.md` and re-verify access still works
  end-to-end before shipping this.
