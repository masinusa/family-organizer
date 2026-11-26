# Threat model

## Assets

- Family PII: names, emails, and any free-text event details (locations,
  descriptions) or feedback that might reveal a family member's schedule,
  whereabouts, or other private information.
- Calendar contents themselves — who's where, when.
- **Shared service credentials** — subscription passwords in the vault, and
  the IMAP app password for the shared family mailbox.
- **Recent contents of the shared family mailbox**, which the vault can read
  on demand.
- The GCP project and its billing account.

## Trust boundaries

```
Internet --> IAP (Google-managed OAuth + access check) --> Cloud Run --> (future) datastore
                                                               ^
                                              GitHub Actions --+ (WIF, deploy only)
```

No *user* authentication in this repo involves a password: IAP handles
authentication, WIF handles CI authorization, and both hand out short-lived
tokens only. The app itself holds no credentials for its own users.

Since the subscription vault (ADR 0007) that is no longer the whole story.
The app now custodies two kinds of secret belonging to *third-party*
services: shared subscription passwords, and a Gmail app password for the
family mailbox. Both live in Secret Manager, are read at request time, are
never written to Firestore or logs, and are covered by the risks below.

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
| An admin can browse as any other account ("view as", `app/src/middleware/impersonation.ts`), so an admin compromise now also reads as, and writes as, every family member | Not a privilege escalation — an admin could already read and edit everything these accounts can, and grant themselves any role — but it does make the acts *attributable to somebody else* (`createdBy` is the impersonated email). Honouring the `view-as` cookie requires the IAP-verified identity to be an admin in Firestore on every single request, so the cookie needs no signing and a forged one is deleted rather than trusted; there is no way to start impersonating without already holding admin. Keep the admin count to the minimum (`/family/accounts` shows every role) |
| Subscription passwords are shared third-party credentials the app now custodies | Stored only in Secret Manager (ADR 0007), never in Firestore — the document holds a `hasPassword` boolean and nothing else; revealed only over an authenticated request from someone on that subscription's access list, with `Cache-Control: no-store`, and every reveal is recorded in a `reveals` subcollection shown on the page |
| Anyone on a subscription's access list — not just an admin — can change the password the vault hands everyone else, and **old passwords are kept readable** rather than being replaced | Deliberate: whoever can collect the current password can already change it at the service, and something is usually still signed in with the old one. Bounded by the same access list, and made answerable rather than prevented — a `passwords/{version}` subcollection records who saved each version and when, shown on the page; a reveal of an old version is logged as such; a version is only readable if it appears in that recorded history, so a submitted version can't address another secret. A genuinely burned password is destroyed by hand in Secret Manager, after which the page reports that version as unreadable |
| The Gmail app password is a long-lived, **mailbox-wide** credential — it grants full IMAP access to that mailbox, far more than the one sender and one week the UI shows | Kept only in Secret Manager, with the value added by hand so it never enters Terraform state or this repo; read at request time and never cached; the IMAP session opens INBOX **read-only**, so the app cannot alter the mailbox even with it. Rotation is minting a new app password and adding a secret version — no deploy. Accepted deliberately in preference to the Gmail API, whose `gmail.readonly` scope is *restricted* (CASA assessment to publish) and whose unpublished-app refresh tokens expire weekly |
| Vault access to a subscription registered to the family mailbox implies read access to **that mailbox** — a real widening of what a family member can see | Bounded by **sender**, not by a clock: the IMAP search is `FROM <the subscription's mailFrom> SINCE <7 days ago>`, and a subscription with no `mailFrom` offers no mail button at all, so there is no unfiltered path. Both filters are re-applied in memory after the fetch, because `SINCE` ignores the time of day and the sender match is the whole boundary. The list shows sender, subject and age; a click opens the full `text/plain` body (capped at 10,000 characters) in a modal, escaped into a `<pre>` — the HTML alternative is discarded at parse time, so mail markup is displayed, never run. Nothing is persisted or logged beyond counts. Every read is recorded in the same audit trail as a password reveal |
| The vault turns URLs inside a third party's email into one-click links, which is the classic phishing path — and a `From` header can be spoofed, so the sender filter is not proof of who wrote the message | The anchor is never markup from the message: the body is split server-side into text runs and `{href, label}` pairs, only `http(s)` matches and the protocol is re-checked after `new URL` parses it, and the view escapes every piece — a body containing `<img onerror=…>` or `href=javascript:` renders as visible text. The label leads with the host (punycoded if non-ASCII, so a lookalike IDN can't read as the real domain) and the full URL is in `href` and `title`; links open with `target="_blank" rel="noopener noreferrer nofollow"`, so the vault's own URL never leaves in a `Referer`. Residual and accepted: a convincing forgery from the subscription's own sender address puts a hostile link one press away, exactly as it would in any mail client |
| `mailFrom` reaches an IMAP SEARCH command, where a quote or a CRLF could end or extend it | Validated to an address-or-domain shape (`/^[a-z0-9._%+-]+(?:@[a-z0-9._-]+)?$/`) and rejected outright otherwise, rather than escaped — the same call `parseLink` makes about a `javascript:` URL. A space is enough to fail it |
| An admin could point `mailFrom` at a **person's** address instead of a service's, turning that subscription's page into a reader for their mail to the shared mailbox | Not preventable in code — a sender is a sender. Admin-only to set, visible on the page to everyone with access, and every read is recorded with who did it. Recorded as a residual risk in ADR 0007 rather than mitigated away |
| The runtime SA can now read **every** secret in the project, since `secretmanager.versions.access` can't be scoped by name prefix on the `secrets.create` half of the grant | Scoped to a narrow custom role (`subscription_secret_manager`, `infra/terraform/secrets.tf`) with five permissions and no IAM-policy access, rather than `roles/secretmanager.admin`. The project holds no secrets other than the vault's own, which is what makes the project-wide grant acceptable today; `secrets.tf` documents splitting it with an IAM condition on `resource.name.startsWith(".../secrets/sub-")` if that changes |
| A `hasPassword` flag and the actual secret can drift, e.g. if a secret is deleted out of band | The flag is only ever set *after* a version lands, so it can't over-promise on write; a reveal that finds no secret says so explicitly instead of rendering an empty box |
| Friend accounts (ADR 0008) pass IAP and `requireFamilyMember` like any family account, so a missing check would show them the whole site | One gate (`app/src/middleware/feature-access.ts`) runs ahead of every feature router and **fails closed**: a path no feature in `app/src/lib/features.ts` claims is family only, so a page added later is hidden from friends by default. A friend account can't be promoted to admin or member (`CROSS_CIRCLE_ERROR`), and `PersonaDirectory` refuses any account whose role disagrees with its person's circle. Friends never appear in family rosters unless opted into that feature (`audience()`) |
| The bootstrap admin doc/IAP binding is a single point of failure — if deleted or demoted with no other admin, nobody can reach `/admin` or even get past IAP | The seed script (`npm run seed:admin`) is idempotent and safely re-runnable as a Firestore recovery path; `bootstrap_admin_email` in Terraform independently guarantees that same email always has IAP access, regardless of the app's own IAM writes; the admin UI itself refuses to demote or delete the last remaining admin |

## Explicitly out of scope for Phase 0

- Per-event permissions (e.g. restricting a specific event to a subset of
  family members) — there's one shared calendar, so there's nothing
  finer-grained to model there. (App-level role/removal authorization was
  added on top of IAP — see the Risks table above.)
- A custom domain — using the default `run.app` URL for now; see
  `docs/roadmap.md` Phase 4 for the plan to revisit this (and re-verify IAP
  behavior) later.
