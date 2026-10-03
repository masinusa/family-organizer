# Knowledge base

A running log for anyone (agent or human) working in this repo. Append,
don't rewrite — newest entry last in each section.

## Pitfalls

- Cloud Run injects `PORT=8080` into the container; nginx's default `listen
  80` will fail health checks. `app/nginx.conf` must explicitly `listen
  8080`.
- **Do not add a `google_iap_brand`/`google_iap_client` resource.** The IAP
  OAuth Admin API they depend on was fully shut down Mar 19, 2026;
  `terraform validate` flags `google_iap_brand` as deprecated and it can no
  longer create anything. There is no Terraform replacement — the OAuth
  consent screen (External audience, auto-generated credentials, since
  family members use personal Gmail accounts, not a Workspace org) must be
  configured once, manually, via Cloud Console before IAP will let anyone
  through. See `docs/adr/0002-gcp-cloud-run-iap.md`. `iap_enabled = true`
  plus the two IAM-member resources in `infra/terraform/iap.tf` are still
  correct and GA — only the consent-screen provisioning moved out of
  Terraform. After any change to that file, manually verify a real
  family-group member can load the Cloud Run URL and gets IAP's login
  prompt — don't trust a clean `apply` alone, since reachability now
  depends on state outside Terraform.
- `google_billing_budget`'s `all_updates_rule` block requires either
  `monitoring_notification_channels` or `pubsub_topic` to be set — it's not
  valid with just `disable_default_iam_recipients`. Simplest fix: omit the
  block entirely; billing account admins still get the default threshold
  emails without it.
- Applying with a *user's* gcloud credentials (not a service account key)
  can fail `google_billing_budget` with `403 ... requires a quota project,
  which is not set by default`, even after `gcloud auth
  application-default set-quota-project`. The ADC file's `quota_project_id`
  isn't respected by every API — `billingbudgets.googleapis.com` billed
  against gcloud's own default OAuth client project (`764086051850`)
  instead. Fix is in `provider.tf`: `user_project_override = true` +
  `billing_project = var.project_id` on the `google` provider block, which
  forces every API call to quota/bill against the target project
  regardless of ADC. Verified working end-to-end on the real project.
- `apis.tf` must include plain `iam.googleapis.com`, not just
  `iamcredentials.googleapis.com` — service accounts and workload identity
  pools need the former. This was masked on the very first `apply` because,
  before the `billing_project` override above was added, those calls were
  incorrectly checking API-enablement against gcloud's own project (which
  has everything enabled), not the target project. Once the override was
  correct, `google_service_account`/`google_iam_workload_identity_pool`
  started failing with `iam.googleapis.com` "not been used in this
  project" until it was added to `local.required_apis` and enabled.
- CodeQL's `javascript` language does **not** silently no-op on a repo with
  zero JS/TS files — it hard-fails the run ("no source code seen during
  build"), confirmed on the very first push. `app/` is static HTML with no
  script, so `.github/workflows/codeql.yml` now scans the `actions`
  language instead (CodeQL's GitHub Actions workflow analysis), which has
  real content to check today. Add the app's real language to the matrix
  once a stack ADR picks one — don't assume an empty-language matrix entry
  is harmless.
- Even after the manual IAP consent-screen setup, the service still
  returned `Empty Google Account OAuth client ID(s)/secret(s)` — the
  console's "Auto-generate credentials" option wasn't offered for this
  project (Sept 2026). Had to create the OAuth client by hand and push it
  to IAP via `gcloud iap settings set`. See the updated
  `docs/adr/0002-gcp-cloud-run-iap.md` and README quick start for the exact
  procedure. The client ID/secret live only in IAP's own settings — never
  in Terraform, never in this repo.
- **Cloud Run Domain Mapping's cert provisioning can stall indefinitely
  behind native IAP.** Google's automatic TLS cert for a domain mapping
  requires a public, unauthenticated ACME HTTP-01 challenge request to
  succeed — but `iap_enabled = true` intercepts that request too (confirmed
  via `curl`: the challenge path got an IAP-generated redirect, not the
  expected 200). Symptom: `gcloud beta run domain-mappings describe` stuck
  on `CertificatePending` with "challenge data was not visible through the
  public internet." Also hit: setting `iap_enabled = false` via Terraform
  `apply` reported success but the live value silently reverted to `true`
  within ~5 minutes with zero other writes in Cloud Audit Logs (a
  suspected provider/API quirk around the `false` zero-value on this
  newer, March-2026-GA'd field — not confirmed, but worth assuming this
  field is unreliable to toggle off/on quickly via Terraform). What
  actually worked: even that brief, imperfectly-controlled window with IAP
  off was enough for the one-time ACME validation to succeed — the cert,
  once issued, doesn't need continued public access to stay valid, so
  don't assume you need `iap_enabled=false` to hold steady for long. See
  the addendum in `docs/adr/0002-gcp-cloud-run-iap.md`.
- **An Eta `<% %>` code block that opens with a bare array/object literal
  (`<% ["a","b"].forEach(...) %>`) can silently break with `Cannot read
  properties of undefined (reading 'forEach')`.** Eta's codegen emits
  `__eta.res+='<preceding text>'` with no trailing semicolon before each
  code block; if any static text precedes the tag (even a single space or
  newline) and the block starts with `[`, JS's automatic-semicolon-insertion
  parses it as `'<preceding text>'["a","b"]` (computed member access on the
  string) instead of two separate statements — the whole `.forEach` then
  runs on `undefined`. Hit this in `app/src/views/calendar.eta`'s weekday
  header loop. Fix: never start a code block with a literal `[`/`(` — assign
  it to a `const` in its own `<% %>` tag first, then iterate the variable
  (identifiers don't trigger ASI merging). Confirmed by diffing
  `eta.compileToString()` output with vs. without leading text — the bug
  reproduces in isolation with zero project-specific code involved.
- **Firestore's `orderBy("field")` silently excludes any document missing
  that field — it doesn't error.** `users-repo.ts`'s `listUsers()` ordered
  by `"email"`, but email is only ever stored as the document ID, never as
  a field, so the query returned zero results even with real docs present
  (`/admin` rendered an empty member list right after a successful seed).
  Fixed by ordering on `FieldPath.documentId()` instead. Caught only by
  manually hitting the running app against the emulator — `npm test`
  wouldn't have caught it, since this repo doesn't run Firestore-backed
  tests against real query behavior.
- **The Admin SDK Directory API cannot manage a consumer Google Group's
  membership at all** — it only works for groups belonging to a Google
  Workspace or Cloud Identity org the caller administers.
  `spicer-familia@googlegroups.com` was a plain group created at
  groups.google.com, not part of any such org (family members sign in with
  personal Gmail, not a Workspace — see ADR 0002). There's no domain-wide
  delegation or service-account trick that gets around this; the group has
  to belong to an org first. Led to ADR 0006: dropped the Group, app now
  grants/revokes `roles/iap.httpsResourceAccessor` per email directly on
  Cloud Run's own IAP resource instead.
- **`https://iap.googleapis.com/v1/{resource}:getIamPolicy` is `POST`, not
  `GET`**, unlike almost every other GCP IAM `getIamPolicy` endpoint — a
  plain `GET` 404s. Confirmed against the live resource with `gcloud iap
  web get-iam-policy --resource-type=cloud-run ... --log-http` before
  relying on it in `app/src/lib/iap-access.ts`; don't assume this one
  follows the usual convention. The resource name accepts either the
  project ID or project number interchangeably
  (`projects/{id-or-number}/iap_web/cloud_run-{region}/services/{name}`) —
  confirmed both work via direct `curl`, though `gcloud`'s own `--log-http`
  output uses the number.

- **Firestore can't range-filter two different fields in one query** without
  a composite index (and the ordering constraints that come with it), which
  is what a "show every event overlapping this month" query naturally wants
  (`startAt < monthEnd AND endAt >= monthStart`). `events-repo.ts`'s
  `listInRange` pushes only the `startAt` bound down to Firestore and applies
  the `endAt` bound in memory — no composite index, nothing to add to
  `firestore.tf`. That trades a little over-fetching (every event starting
  before the month shown) for not maintaining an index, which is the right
  way round at family-calendar scale; revisit if the collection ever holds
  thousands of events. The symptom this fixed: a trip that began in November
  was invisible on December's grid, because the old query matched on
  `startAt` alone.

- **A CSS grid's `1fr` floors at its content's width, so one long event
  title widened its whole calendar column.** `grid-template-columns:
  repeat(7, 1fr)` in `app/src/views/layout.eta` looks like "seven equal
  columns" but `1fr` is `minmax(auto, 1fr)` — the `auto` minimum is the
  largest unbreakable content in that column, so a cell containing
  "Thanksgiving at Nana's" pushed Thursday wide and squeezed the other six.
  Only visible once events had colour-filled chips. Fix is
  `repeat(7, minmax(0, 1fr))`; the chips' own `overflow: hidden` +
  `text-overflow: ellipsis` then does the truncating.

- **A `:not(:has(...))` rule matches elements that don't contain the thing
  at all, which is rarely what you mean.** The roster in
  `app/src/views/_event-fields.eta` hides a family member's response until
  they're actually on the event, written as
  `.roster-row:not(:has(.involve:checked)) .seg { display: none }`. Guest
  rows share `.roster-row` but have no `.involve` checkbox — so the
  `:has()` was false, the `:not()` was true, and every guest's response
  control vanished. Fix is to require the control first:
  `.roster-row:has(.involve):not(:has(.involve:checked))`. Worth assuming
  any `:not(:has(x))` needs a matching `:has(x)` guard whenever the
  selector covers more than one kind of row.

## Decisions

- Chose native Cloud Run IAP over the older load-balancer + Serverless NEG +
  backend-service pattern (see `docs/adr/0002-gcp-cloud-run-iap.md`) —
  simpler and removes a recurring LB cost line, which matters for a
  single-digit-dollars/month budget.
- IAP access is gated by a Google Group (`iap_access_group` variable), not
  individual account bindings, so membership changes don't require a
  `terraform apply`.
- `app/` stays a static placeholder until a stack ADR is written — don't
  infer a framework choice from its current contents.
- `GET /` now renders a month grid (`app/src/views/calendar.eta`) instead
  of the old flat upcoming-events list, which was removed. Events are
  bucketed onto a day cell by `startAt`'s local calendar date only, so a
  multi-day event currently only renders on its start day — no logic
  spans it across the days it covers.
- Added a Firestore `users` collection as an explicit, app-level access
  gate *behind* IAP: doc id is the lowercased email, the only field is
  `role` (`admin`|`member`). Deliberately **no self-provisioning** — being
  in the IAP Google Group only proves someone can complete Google sign-in,
  it does not grant app access. An admin must add a doc via `/admin` (or
  the seed script) before that email can use anything past the health
  check. Removing someone is a real Firestore delete, not a status flag —
  chosen over a soft-delete/tombstone specifically because this repo has
  no self-provisioning to "undo": without it, a soft-delete would add
  complexity for no benefit. The very first `admin` doc has no
  special-casing in code and is seeded once via `npm run seed:admin`,
  idempotent/safely re-runnable as a recovery path; the admin UI refuses
  to demote or delete the last remaining admin to avoid a total lockout.
- **Superseded the Google-Group decision above.** The Firestore `users`
  collection is now the single source of truth for both app access and
  IAP access — `/admin` grants/revokes `roles/iap.httpsResourceAccessor`
  per email directly, no Group involved, no `iap_access_group` variable
  anymore. See ADR 0006 and the Pitfalls entries above for why (a consumer
  Google Group can't be managed by API at all) and how (IAP's own IAM
  policy, not the Admin SDK).

- Events now carry people, a colour category, and a link. Attendees are an
  array of `{email, name, status}` maps on the event doc — `email` set for a
  family member (matching a `users` doc id), `name` set for an off-app guest
  (extended family with no account), and `status` one of
  `invited|yes|maybe|no`. Deliberately denormalised onto the event rather
  than a subcollection or join collection: the only query needed is "render
  this event", and a family event has single-digit attendees. A member's own
  response is also settable in one tap from the event page
  (`POST /events/:id/rsvp`), which only ever writes the caller's own status —
  the email comes from the verified IAP identity, never the form.
- Event categories are **built-ins in code plus custom docs in Firestore**
  (`DEFAULT_CATEGORIES` in `app/src/lib/categories.ts`, collection
  `categories`). Keeping the defaults in code means no seeding step, no
  empty-state, and nothing to restore if the collection is wiped. An event
  stores only the category id, and `resolveCategory` falls back to a neutral
  colour for an unknown/absent id — which is what makes deleting a category
  safe without touching a single event doc. Adding one is open to every
  family member, not admin-gated: whoever is planning the trip should be
  able to label it. Colours are validated to `#rrggbb` on the way in *and*
  on the way out of Firestore, because they're interpolated into `style`
  attributes.
- The month grid now spans a multi-day event across every day it covers
  (superseding the start-day-only note above), and packs each week's events
  into fixed rows so a running bar keeps the same row all week. The `null`
  entries in `CalendarDay.events` are deliberate: they hold a row open on a
  day where an earlier event has ended, without which the bar visibly jumps
  up a line and stops reading as one continuous run.

- Clicking any empty part of a day cell opens a **quick-add modal** on that
  day, rather than navigating to the form page. To avoid a second,
  divergent copy of the event form, every field lives in one partial
  (`app/src/views/_event-fields.eta`) included by both `event-form.eta` (the
  full page) and `calendar.eta` (the modal) — so `renderCalendarPage` has to
  load the member list and categories too. The day number stays a real link
  to `/events/new?date=...` as the no-JavaScript path, and the click handler
  suppresses it; event chips keep their own navigation. A validation failure
  on a modal submit falls through to the full form page with the values and
  the error, which is the existing behaviour and needs no extra code.

- The event form collapses into **sheets**: only the title and dates are
  open on arrival, and Category / Who's involved / Details are `<details>`
  whose closed row states what's inside (the chosen colour, a stack of
  faces and a count, "Nana's house · link · notes"). This is what keeps the
  quick-add modal a single screen regardless of how many family members
  exist — the roster scrolls inside its own sheet rather than stretching
  the form. Guest rows are added on demand from a `<template>` instead of
  rendering blank spares.
- A family member is on an event because their `involved:<email>` checkbox
  is ticked, not because a status field was submitted for them. The roster
  renders a response control for everyone, so without that gate every
  family member would be attached to every event. `memberStatus:<email>` is
  only read once the gate is set, and both are still looked up per known
  member — never by scanning submitted field names.
- People get **deterministic avatars** (`app/src/lib/people.ts`): initial,
  a colour hashed from the email or guest name, and a display name derived
  from the email's local part ("mary.jane+cal@x.com" → "Mary Jane"). The
  palette is deliberately all dark enough that every avatar takes white
  text, so a roster reads as one set. The same faces appear on the form,
  the collapsed summary and the event page, which is what makes "who will
  be where" scannable rather than a list of addresses.

## Guidelines

- Terraform owns the Cloud Run service's shape (ingress, IAP, IAM); GitHub
  Actions only ships new image tags. `lifecycle { ignore_changes =
  [template[0].containers[0].image] }` on the service is what keeps these
  from fighting each other — don't remove it.
- The budget alert is notify-only (email at 50/90/100% of spend), not a
  hard spending cap. Scale-to-zero Cloud Run and no load balancer are what
  actually bound cost.
- Multi-row form sections that need adding/removing rows without
  JavaScript follow the `guestName:<i>` / `guestStatus:<i>` convention in
  `app/src/lib/event-input.ts`: the form always renders a few blank spare
  rows, parsing skips rows with a blank name, and **clearing a row's name is
  how you delete it**. Indexes are positional and re-numbered on every
  render, so never treat them as stable ids.
- Anything a family member types that ends up inside an HTML attribute needs
  validating for *shape*, not just escaping. Two live examples: category
  colours must match `#rrggbb` before reaching a `style` attribute, and an
  event's link must parse to an `http:`/`https:` URL before reaching an
  `href` — Eta's `<%=` escaping alone would happily emit
  `href="javascript:..."`.
- `_event-fields.eta` carries its own `<script>` (the all-day/time-field
  toggle) and uses fixed element ids (`all-day`, `start-date`, `end-date`).
  That's safe only because no page includes it twice — if one ever needs to,
  those ids have to become per-instance first. Its script also re-syncs on
  the form's `reset` event, because the quick-add modal calls
  `form.reset()` every time it opens and a reset lands *after* its own event
  fires (hence the `setTimeout(..., 0)`).
- When JavaScript needs to show a copy of something the server already
  rendered, **clone the element rather than rebuilding it**. The form's
  collapsed "Who's involved" row clones each roster avatar into its face
  stack, so it inherits the server's hashed colour for a saved person, the
  dashed placeholder for a guest still being typed, and the live initial —
  with no palette or hash duplicated into the browser. Rebuilding it from
  `data-` attributes is what lost saved guests their colour the first time.
