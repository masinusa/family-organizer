# Threat model

## Assets

- Family PII: names, emails, and any free-text event details (locations,
  descriptions) that might reveal a family member's schedule or whereabouts.
- Calendar contents themselves — who's where, when.
- The GCP project and its billing account.

## Trust boundaries

```
Internet --> IAP (Google-managed OAuth + access check) --> Cloud Run --> (future) datastore
                                                               ^
                                              GitHub Actions --+ (WIF, deploy only)
```

Nothing in this repo's code path ever sees a password or a long-lived
credential: IAP handles authentication, WIF handles CI authorization, and
both hand out short-lived tokens only.

## Risks and mitigations

| Risk                                                                   | Mitigation                                                                                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Over-broad Google Group membership grants calendar access to the wrong people | Group is a Terraform variable so it's explicit and auditable; document who's a member outside this repo                         |
| A WIF misconfiguration lets another GitHub repo impersonate the deployer SA | `attribute_condition` on the WIF provider pins federation to this exact repo (`masinusa/family-organizer`)                     |
| Terraform state bucket exposure (state contains resource IDs, not secrets, but is still sensitive) | Uniform bucket-level access + public access prevention + versioning, created before Terraform ever touches the project           |
| A secret gets committed to this public repo                            | `.gitignore` + pre-commit gitleaks + CI gitleaks as a backstop; the real mitigation is that no secret should ever need to exist (WIF removes CI keys, IAP removes app-level credentials) |
| IAP OAuth consent screen misconfigured or skipped (it's a manual, non-Terraform step) | Documented as a required one-time setup step in the README quick start and `docs/adr/0002-gcp-cloud-run-iap.md`; verify manually post-setup that a real group member can authenticate |
| Cost overrun                                                            | Budget alert is notify-only, not a hard cap; actual cost is bounded by Cloud Run's scale-to-zero and the absence of a load balancer |
| Being let into the family Google Group only proves someone *can* sign in via IAP — that alone shouldn't imply they get app access | A Firestore `users` collection is a second, explicit gate behind IAP: an admin must add a doc for an email via `/admin` (or the seed script) before that person can use the app at all; removing someone deletes their doc outright, so revocation is immediate, not a manual, delayed Google Group edit |
| The bootstrap admin doc is a single point of failure — if deleted or demoted with no other admin, nobody can reach `/admin` | The seed script (`npm run seed:admin`) is idempotent and safely re-runnable as a recovery path; the admin UI itself refuses to demote or delete the last remaining admin |

## Explicitly out of scope for Phase 0

- Per-event permissions (e.g. restricting a specific event to a subset of
  family members) — there's one shared calendar, so there's nothing
  finer-grained to model there. (App-level role/removal authorization was
  added on top of IAP — see the Risks table above.)
- A custom domain — using the default `run.app` URL for now; see
  `docs/roadmap.md` Phase 4 for the plan to revisit this (and re-verify IAP
  behavior) later.
