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
| A WIF misconfiguration lets another GitHub repo impersonate the deployer SA | `attribute_condition` on the WIF provider pins federation to this exact repo (`masinusa/family-organizer`)                     |
| Terraform state bucket exposure (state contains resource IDs, not secrets, but is still sensitive) | Uniform bucket-level access + public access prevention + versioning, created before Terraform ever touches the project           |
| A secret gets committed to this public repo                            | `.gitignore` + pre-commit gitleaks + CI gitleaks as a backstop; the real mitigation is that no secret should ever need to exist (WIF removes CI keys, IAP removes app-level credentials) |
| IAP OAuth consent screen misconfigured or skipped (it's a manual, non-Terraform step) | Documented as a required one-time setup step in the README quick start and `docs/adr/0002-gcp-cloud-run-iap.md`; verify manually post-setup that a real family member can authenticate |
| Cost overrun                                                            | Budget alert is notify-only, not a hard cap; actual cost is bounded by Cloud Run's scale-to-zero and the absence of a load balancer |
| The Firestore `users` collection is the single source of truth for both app access and who can pass IAP (ADR 0006) — a bug there now has a bigger blast radius than before | `createUser`/`deleteUser` (`app/src/lib/users-repo.ts`) are the only callers of `iap-access.ts`; removing someone deletes their Firestore doc outright and best-effort revokes IAP access, so revocation is immediate on the app side even if the IAP call itself fails |
| The runtime service account can now edit its own IAP IAM policy — a new capability that, if compromised or buggy, could grant unauthorized access | Scoped to a custom role (`iap_access_manager`, `infra/terraform/iap.tf`) with only `iap.web{Services,ServiceVersions}.{get,set}IamPolicy`, not the broader predefined `roles/iap.admin`; a failed IAM write is logged and never silently retried with different input |
| The bootstrap admin doc/IAP binding is a single point of failure — if deleted or demoted with no other admin, nobody can reach `/admin` or even get past IAP | The seed script (`npm run seed:admin`) is idempotent and safely re-runnable as a Firestore recovery path; `bootstrap_admin_email` in Terraform independently guarantees that same email always has IAP access, regardless of the app's own IAM writes; the admin UI itself refuses to demote or delete the last remaining admin |

## Explicitly out of scope for Phase 0

- Per-event permissions (e.g. restricting a specific event to a subset of
  family members) — there's one shared calendar, so there's nothing
  finer-grained to model there. (App-level role/removal authorization was
  added on top of IAP — see the Risks table above.)
- A custom domain — using the default `run.app` URL for now; see
  `docs/roadmap.md` Phase 4 for the plan to revisit this (and re-verify IAP
  behavior) later.
