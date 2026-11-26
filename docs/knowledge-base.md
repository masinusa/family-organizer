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

- **Eta's `<%= %>` XML-escapes, and a `<script>` body is raw text the HTML
  parser never decodes — so escaped output arrives in JavaScript mangled.**
  `var returnTo = <%= JSON.stringify(it.returnTo) %>;` in
  `app/src/views/calendar.eta` emitted
  `&quot;/?year=2026&amp;month=11&quot;`, which is a syntax error, not a
  string. Inside a `<script>` the interpolation has to be `<%~ %>` (raw),
  which in turn means only ever interpolating values the server built
  itself — here a path assembled from two parsed numbers. Values with no
  special characters (a `YYYY-MM-DD`, an integer) survive `<%= %>` by luck,
  which is what makes this easy to miss.
- **A stale `tsx watch` process can hold :3000 and silently serve old
  code.** `scripts/dev-local.sh` starts the server with `nohup` and records
  one PID, but killing that PID doesn't always take the watcher's child
  with it; the next run then fails with `EADDRINUSE` *in the log* while the
  script still reports "Running at http://localhost:3000" — because
  something is indeed answering. Symptom is changes that don't appear and
  new routes returning Express's default HTML 404. Check
  `tail /tmp/family-organizer-dev.log` before debugging the code, and clear
  it with `pkill -f "tsx watch src/server.ts"` plus
  `lsof -ti:3000 | xargs kill -9`.

- **Dropping the Google Group (ADR 0006) stranded existing members: nobody
  backfilled the IAP IAM policy from the `users` collection.** ADR 0006
  reasoned that group-only members lose nothing because `requireFamilyMember`
  already blocked them — true only for someone with no Firestore doc. Anyone
  added *before* the grant code shipped had a `users` doc (app access) but
  got their IAP access from the group binding, so removing that binding
  locked them out at the login prompt with no trace: no error, no log line
  (the grant code never ran for them), and `/family/accounts` still listing
  them as able to sign in. Found in Oct 2026, two weeks later, only because
  someone said they couldn't get in. Diagnose a "can't log in" report by
  comparing both gates — `gcloud iap web get-iam-policy --resource-type=cloud-run
  --region=<region> --service=<service>` against the `users` collection — and
  fix with `gcloud iap web add-iam-policy-binding ... --member=user:<email>
  --role=roles/iap.httpsResourceAccessor`. A reconcile check that surfaces
  this drift in the UI still doesn't exist.
- **`setIamPolicy` rejects an email with no Google account, and
  `IAP_SYNC_WARNING` tells the admin to retry something that can never
  succeed.** A mistyped address fails the IAM write with
  `User <email> does not exist.` (HTTP 400) while the Firestore doc saves
  fine, so the person shows up as having an account forever. The warning
  text ("the Google access change didn't go through — sign-in may not work
  yet. Try again in a moment.") reads as transient, but a nonexistent user
  is permanent until the email itself is corrected — and a typo is the most
  likely cause, since a real address is what makes the call succeed. Worth
  distinguishing that one error from a genuine hiccup before telling anyone
  to wait. Note a correction needs three fixes, not one: the person's email,
  the stale `users` doc under the wrong address, and then a fresh grant.
- **IMAP's `SINCE` search key is day-granular — it cannot express "the last
  15 minutes".** The vault's Recent-mail window looked like something to push
  down to the server (`client.fetch({ since: fifteenMinutesAgo })`), but
  `SINCE` compares dates with the time discarded, so that query returns
  everything that arrived today — on a busy mailbox, hundreds of messages,
  each then fetched and MIME-parsed. `app/src/lib/mailbox.ts` instead takes
  the last 20 messages by *sequence number* (`${first}:*`) and applies the
  real cutoff in memory in `toRecentMessages`, which is also what makes the
  window unit-testable without a mailbox. Don't assume an IMAP search key has
  the granularity its name suggests.
- **Eta's `<%= %>` renders `null` as the literal string "null".** Not empty —
  the four characters. Harmless in a `<p>` you've already guarded with an
  `if`, but `value="<%= it.subscription.accountEmail %>"` on an edit form puts
  the word "null" in the input, and saving the form then stores it. This is
  why `event-input.ts` has an all-strings `FormValues` type at all; the
  subscription detail route does the same with a `values` object
  (`?? ""` per field) rather than handing the raw doc to the form. Confirmed
  with `eta.renderString('[<%= it.x %>]', { x: null })` → `"[null]"`.
- **A digit-boundary guard like `(?<!\d)(\d{4,8})(?!\d)` still matches
  inside an alphanumeric token.** `findCode` in `app/src/lib/mailbox.ts`
  lifts a likely one-time code out of an email, and this pattern happily
  returned `12345` from `ref ab12345cd` or `AB12345` from an order
  confirmation — the lookarounds only reject adjacent *digits*, and a letter
  isn't a digit. Fix is to exclude both: `(?<![\p{L}\d])(\d{4,8})(?![\p{L}\d])`.
  Worth assuming any "standalone number" regex needs the letter case spelled
  out too. Caught only because the test asserting it was *named*
  "ignores digits embedded in a longer token" while asserting the opposite —
  a test name that contradicts its assertion is worth re-reading as a bug
  report about the code, not just the name.

- **An apostrophe inside a JavaScript comment in an Eta `<% %>` block
  silently swallows the rest of the template.** Eta skips delimiters that
  sit inside string literals, and it does not know a `//` comment is a
  comment — so `// so there's a single place` opens a quote that runs on
  until the next `'` in the file, taking the closing `%>` with it.
  Everything after is compiled as JavaScript and the only clue is
  `EtaParseError: Unexpected token '%'`. Keep apostrophes out of comments
  inside template tags. This also showed why rendering a touched template
  once is worth it: `tsc` and the unit tests both passed with the template
  completely broken, because nothing in the test suite renders a view.
- **"Standalone digit run" has no useful definition in an email, and the
  `findCode` heuristic above is now deleted.** The letter-and-digit boundary
  fix landed, the tests passed, and it still produced a confident wrong
  answer on the first two real Netflix mails: `7700` from
  `Call 1-844-569-7700`, and `4211` from a UUID in
  `help.netflix.com/help?g=4cd44ecb-4211-405b-…`. A hyphen, `=`, `/` and `.`
  are all boundaries, and a phone number and a UUID are *made* of
  digit-runs separated by exactly those — the zip code in the same footer
  was next. Two lessons worth more than the regex: the mitigation
  ("the snippet is shown beside it, so a wrong guess is obvious") was
  checkable and false — both matches sat ~1500 characters past the end of a
  180-character snippet — so **state a mitigation in terms a test can
  reach**; and every unit test fed the function a sentence containing only
  the code, never a signature block, which is how a heuristic passes nine
  tests and fails on message one. Reach for real inputs early when the thing
  under test is a guess about human text.
- Eta escapes `'` to `&#39;`, and the browser decodes that back to `'`
  **before** an inline handler's JavaScript runs. So
  `onsubmit="return confirm('Delete <%= name %>?')"` is not made safe by
  escaping: a name containing `');alert(1);('` runs. `views/friends.eta`
  uses a fixed message for this reason. `views/subscription.eta` still
  interpolates the (admin-set) subscription name this way. The same
  escaping trips up tests: assert on `isn&#39;t`, not `isn't`.
- A test asserting that a page *doesn't* contain something has to
  match markup, not a bare class name: `layout.eta` inlines all the CSS, so
  `/santa-table/` matches the stylesheet on every page. Assert on
  `class="santa-table"` or `name="to:`.

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

- Feedback is stored in a private Firestore collection and triaged by admins
  in the app. Do not automatically create GitHub issues or send feedback by
  email: free-text family feedback can contain PII, while Firestore stays
  behind the existing IAP and app authorization boundary.

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

- Opening an event on the calendar **fetches its card into a modal**
  rather than navigating, because leaving the page lost whichever month was
  being read — the point of the calendar is looking ahead.
  `views/_event-card.eta` is shared by `GET /events/:id` (the full page,
  still the direct-link and no-JS route) and `GET /events/:id/card`, which
  returns the same markup with no layout. Answering or deleting inside the
  modal posts with `fetch` and re-renders the card in place, so the grid
  underneath never reloads.
- Flows that genuinely do leave the calendar — Edit, and saving a new event
  from the quick-add modal — carry a `return` path back to the month they
  started from, validated by `safeCalendarReturn()` in `lib/calendar-page.ts`.
  That helper only accepts the calendar itself with an optional month, and
  **re-builds the string from the parsed numbers rather than echoing the
  input**, so nothing can ride along in a redirect.
- Tapping the response you already gave clears it: the button posts
  `invited` ("on the event, hasn't answered") instead of its own status.
  Entirely a view decision — `POST /events/:id/rsvp` already accepted every
  status, so no route or repo change was needed. Clearing deliberately
  leaves you *on* the event rather than removing you, which keeps an
  invitation someone else extended; coming off an event entirely is a tap
  on your row in the edit form's roster.
- The calendar shows the selected month plus the following month as two
  **stacked full grids**, rather than a cramped desktop row or three-month
  scroll. This keeps event titles, multi-day bars, and day-cell quick-add
  usable at every viewport; use the month switcher for prior months or a
  longer look-ahead.

- A sideways link between two people is a **generic relationship**, not a
  partnership: `PersonDoc.connectionIds` (formerly `partnerIds`), drawn as
  a plain horizontal line in the same stroke as every other connector. The
  heart that used to sit at its midpoint is gone, along with the dashed
  accent styling — the tree records people who belong side by side, which
  is often but not always a couple, and nothing in the drawing should
  assert which. The layout still treats a connection the way it treated a
  partnership (same row, placed adjacent, centred as a pair over shared
  children); only the meaning and the ink changed. The field rename is a
  real migration, not a tolerated second shape: `npm run
  migrate:connections` moves every person over once per deployment, and a
  doc still missing `connectionIds` throws with that command in the
  message rather than reading as "no connections".
- Parents and connections are edited in **one relationships section** on
  the person page: a single list where every link reads the same way
  (`↑ Parent` / `↔ Relationship` / `↓ Child`), and one add form whose first
  field picks which kind you are making — a parent takes one or two people,
  a relationship takes one. "Relationship" is the word on screen because it
  is what someone would say out loud; the field and the `kind` wire value
  stay `connection*`, since in code that word has to mean only the sideways
  link (a parent is a relationship too). That replaced a Ctrl/Cmd-click
  multi-select for parents plus a separate add/remove form for partners.
  Both kinds post to `POST /family/:id/relationships` and come off at
  `POST /family/:id/relationships/remove`, with `kind` deciding which
  fields are read, so the page has one editor rather than one per kind.
- The pickers only offer links that would be accepted — self, existing
  links and descendants are filtered out in the route, and the parent half
  closes off at two. The rules in `people-repo.ts` (at most two parents, no
  self, no cycles) stay as the backstop, but they are no longer how someone
  finds out. Adding or removing one parent still goes through `setParents`
  with the whole recomputed set, because every one of those rules is a
  property of the set rather than of a single edge.

- An admin can **view the site as another account** ("view as", the warning
  triangle in the top bar). `middleware/impersonation.ts` reads a `view-as`
  cookie and *rewrites `req.user`* between `iapAuth` and
  `requireFamilyMember`, so the pretend identity flows through the app's own
  authorization layer and everything below it: viewing as a member really is
  refused `/family/accounts`, and an event created while impersonating is
  created *by* that member. That is the whole reason it works at the
  identity layer rather than as a per-page preview — a preview that fakes
  only the rendering would miss exactly the bugs this is for.
  - The cookie is unsigned on purpose. It names only *who* to become, and is
    honoured only after the IAP-verified email has been looked up and found
    to be an admin, so forging it gains nothing; a non-admin who sets it by
    hand just has it deleted on the next request.
  - `req.impersonator` holds the real admin's doc while impersonating, and
    the impersonation controls authorize against *that* (`realAdmin()`),
    never `req.appUser` — otherwise viewing as a member would take away the
    control that gets you back. For the same reason `POST /impersonate/stop`
    is mounted ahead of `requireFamilyMember` and has no guard at all:
    clearing your own cookie can't grant anything, and it has to work in the
    one case where every other page 403s (the impersonated account was
    deleted meanwhile). `forbidden()` in `access-control.ts` renders the
    banner too, so a 403 is never a dead end.
  - The account list is fetched when the picker dialog opens
    (`GET /impersonate/picker`, a bare fragment) rather than rendered into
    every page — same pattern as `GET /events/:id/card`. It costs two
    Firestore reads and only an admin ever sees it, so no normal page render
    should pay for it.
- `lib/chrome.ts` is the one place the top bar's data is assembled. Four
  routers each had their own `{ email, isAdmin, active }` copy; the
  impersonation banner added fields that have to stay in step across all of
  them, which is one copy too many. Note `isAdmin` there is the *effective*
  role and `canImpersonate` the real one — they deliberately disagree while
  impersonating.
- Subscription passwords live in **Secret Manager, never Firestore** — the
  doc carries only a `hasPassword` flag, and the secret id is *derived* from
  the doc id (`sub-{docId}`) rather than stored, so there's no second name to
  drift. `hasPassword` is flipped only after a version really lands, so the
  vault can't advertise a password it can't produce. Reached over the REST
  API with `google-auth-library` (already a dependency, same as
  `iap-access.ts`) rather than adding the gRPC
  `@google-cloud/secret-manager`. See ADR 0007, which also covers why Gmail
  IMAP + an app password beat the Gmail API here (`gmail.readonly` is a
  *restricted* scope needing a CASA assessment to publish; an unpublished
  app's refresh tokens expire every 7 days).
- The vault **filters by viewer in memory** rather than querying
  `where("memberEmails", "array-contains", email)`, because combining that
  with `orderBy("name")` needs a composite index — the same trade
  `events-repo.ts`'s `listInRange` already makes. Nothing in a subscription
  doc is secret (the password is in Secret Manager), so reading them all
  inside the server leaks nothing. Mind the `orderBy` pitfall above while
  doing it: every write must set `name`, or the doc vanishes from the list.
- **Revealing a password is a plain `POST` that re-renders the page**, not a
  `fetch`/JSON endpoint like `GET /events/:id/card`. Far less code, and it
  works with JavaScript off — the only JS involved is the countdown that
  removes the value again. Responses carrying a password or mailbox content
  set `Cache-Control: no-store`. Note what this does *not* add: no POST in
  this app has a CSRF token, and a forged reveal POST can't be read
  cross-origin, so it could only pollute the audit log — adding CSRF is a
  whole-app change, not part of this feature.
- A subscription that can't be seen by the viewer **404s rather than 403s**,
  so the vault never confirms to someone that a subscription exists when they
  have no access to it. `/family` does the opposite (403 with an explanation)
  because there the resource's existence isn't the secret.
- Which secret backend is live is keyed off **`FIRESTORE_EMULATOR_HOST`**,
  not a new env var: `dev-local.sh` (emulator, throwaway project id) gets an
  in-process `Map` so the password flow stays clickable with no GCP behind
  it, and `dev-local-real.sh` reaches the real store through the developer's
  ADC. Deliberately *not* the silent no-op `iap-access.ts` uses — a password
  feature that quietly does nothing is worse than one that is visibly fake,
  so the fake backend actually stores and returns values and warns once at
  first use. Consequence worth remembering: a password saved under
  `dev-local-real.sh` is the real one.
- The vault's **audit trail follows the real Google account, not an
  impersonated one** (`realEmail(req)` from `middleware/impersonation.js`),
  while access checks follow the impersonated one. Everything else in the
  app, `createdBy` included, attributes to whoever is being viewed as — that
  is the point of view-as — but a `reveals` row saying "Mum got the
  password" when an admin did, viewing as Mum, is a false entry in the one
  record the vault's "take it without asking, but it's on the record"
  bargain rests on. The two identities disagreeing on purpose is worth a
  comment wherever it happens.

- **A person is drawn one way everywhere: a `Persona`**
  (`app/src/lib/persona.ts`). This replaces the "deterministic avatars"
  decision above. `lib/people.ts` and its email-derived names are gone,
  because the calendar showed "Mary Jane" in purple while the tree showed
  "Mary Jane Smith" in her chosen sage. `PersonaDirectory` joins `people` to
  `users` by normalized email, once. Each persona carries name, email,
  role (non-null means *active*, i.e. can sign in), two-letter initials and
  a `PERSONA_COLORS` swatch. The chosen colour wins, otherwise it's hashed
  from the name. Guests hash into the same palette. Templates draw a
  persona only through `views/_persona-avatar`, `_persona-chip`,
  `_persona-row` and `_persona-picker`, never with ad-hoc markup.
  - `users` and `people` stay separate collections. `users` is the access
    record that IAP sync and `requireFamilyMember` key on (ADR 0006), and
    merging role onto people would mean redoing that security boundary to
    fix a display problem.
  - The directory is loaded once per request by `middleware/personas.ts`,
    after `requireFamilyMember`, into `req.personas` and `req.persona`.
    That's two reads on every page, at family scale, in exchange for no
    route re-joining the collections itself. A page re-rendered in place
    after a write has to reload it (`refreshPersonas` in `routes/family.ts`).
  - A stored email that no longer matches anyone (an old attendee,
    `createdBy` or `submittedBy`) resolves to an explicit `unknown` persona:
    the raw address in grey. That's a real state of the data, and it never
    guesses a name.
- **Every account belongs to somebody on the tree.** `PersonaDirectory`
  throws on a `users` doc with no matching person, rather than inventing a
  name for it. The pieces that keep it that way:
  - `npm run migrate:personas` creates a placeholder person for each
    existing orphan, once per deployment.
  - `seed:admin` now takes a name.
  - Access is granted only from a person's page. The bare-email grant on
    `/family/accounts` and the "link an existing account" picker are gone.
  - A person's email can't change, and the person can't be deleted, while
    they still have access. Remove access first. Otherwise the old address
    would be left as an account nobody owns.
- **One picker for choosing people**: `views/_persona-picker.eta`. It's a
  list of radio or checkbox rows with avatars, not a `<select>`, because an
  option can't hold a face. Being plain inputs, it needs no JavaScript.
  The filter box (shown above six people) and the `data-max` cap are one
  delegated script in `layout.eta`, so a picker fetched in later (View as)
  gets them too. The server still enforces the cap (`TOO_MANY_PARENTS_ERROR`).
  The event roster reuses `_persona-row` rather than the picker, because
  each row also carries an RSVP control.
- The subscriptions vault draws people as personas too. Its access list,
  password history and "Recently viewed" log are `_persona-row`s, and
  admins edit access with the shared picker. Access now posts as `members`
  checkbox values instead of one `member:<email>` field per person.
  `parseMemberEmails` still keeps only addresses on the active-member list,
  so the rule against storing a hand-posted address is unchanged. The audit
  log keeps recording `realEmail(req)`. A persona only changes how that
  stored email is drawn.
- Friends (ADR 0008) are `people` docs with `circle: "friend"` and an
  account with role `friend`, not a separate collection, so they're still
  one Persona. `PersonaDirectory.all()`/`active()` return **family only**.
  That keeps the tree, the accounts list and every pre-existing roster
  family-only without touching their call sites. Use `friends()`,
  `withAccounts()` or `audience(featureKey)` when a friend should appear.
  `/family/:id` 404s for a friend's id (`familyRouter.param`), so no
  hand-posted form can give a friend parents or a family account.
- Who can open which page is decided in one place: `lib/features.ts` plus
  `middleware/feature-access.ts`. A path no feature claims is family only.
  The gate fails closed, so a new page is invisible to friends until it's
  registered there. Static files are served above the gate, because the
  favicon belongs to no feature.
- Secret Santa's assignment map lives on the exchange doc
  (`secretSantas/{year}.assignments`), not in a subcollection per giver.
  It's read whole on every page anyway, to draw the viewer's own pair
  and to flag unassigned people for admins. Nothing reaches the browser
  except through `recipientOf` (one pair) or the admin's opt-in table.
  Changing who's in **prunes** pairs that name someone who left and keeps
  the rest, instead of redrawing. Some people may already have shopped, so
  the page names who's left without a pair and the admin decides. A
  person still in any exchange can't be deleted, from the tree or from
  `/friends`. That's what keeps `personaFor` in `routes/christmas.ts`
  free to throw on an id that resolves to nobody.
- The draw is randomised backtracking with a step cap
  (`drawAssignments`), not "shuffle until it works". The rules (partners
  both ways, last year's pair as drawn) can make a draw impossible, and the
  cap is what turns "impossible" into a clear error instead of a
  hung request. Tested over 500 seeded draws for validity, not over one.
- Wish lists are a textarea, one idea per line, with a pasted link lifted
  out of its line (`lib/wishlist.ts`). No add/remove-row JavaScript, and it
  reads like the list people would write anyway. It reuses `parseLink` for
  the http(s) check and the mailbox linkifier's trailing-punctuation rule.
  `wishlistText` is the inverse, and a test checks that the round trip
  changes nothing, so re-saving an untouched list is a no-op.
- Anonymity is tested by rendering, not by reading the template:
  `test/christmas-routes.test.ts` spins up the real router on a port, renders
  every participant's page, and asserts their Santa's **name** appears
  nowhere in the HTML. That catches leaks a template review misses, like a
  name in a `title`, an `aria-label`, or a form action. The notes routes
  take no ids at all, so the test also posts hand-crafted `giverId` and
  `receiverId` fields and checks they're ignored.

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
- A form that may be submitted both normally and through `fetch` should
  keep its `onsubmit="return confirm(...)"` and **not** re-ask in the
  JavaScript handler: a `submit` event only fires once the inline handler
  has returned true, so confirming in both places prompts twice. The delete
  form in `_event-card.eta` works this way — guarded on the full page,
  guarded once in the modal.
- Secret Manager keeps every version of a secret, so "keep the old
  passwords" needs no storage of its own — but it records only *when* a
  version landed, never *who* asked for it. The vault's
  `subscriptions/{id}/passwords/{version}` docs are that missing half, and
  doubling as the list the history page renders is what keeps the app off
  `secretmanager.versions.list` (so the custom role in `secrets.tf` didn't
  have to grow). It also means a version is only readable through the app if
  the app recorded it: `parsePasswordVersion` checks a submitted version
  against that history before it reaches a resource path.
- `addVersion` returns the new version as a full resource name
  (`projects/p/secrets/s/versions/4`) and the last segment is the id the
  rest of the API takes. Versions are numbered from **1**, so the in-memory
  dev backend's array index won't do as a stand-in.
- Accessing a *disabled or destroyed* secret version returns **400
  FAILED_PRECONDITION**, not 404. `secret-store.ts` maps both to `null`,
  since to a reader "destroyed" and "not there" are the same answer — only
  a genuinely unexpected status should propagate.
- `.card a` in `layout.eta` styles a card's link as **bold ink-coloured text
  with no underline**, which on the vault list read as a heading rather than
  a control — nobody could tell the name was what you clicked. The fix is
  the `.person-card` pattern from the tree: make the whole card the `<a>`,
  so the hit target is the card and the hover lift says it opens. If you add
  a list of cards, assume a bare `.card a` looks inert and give it an
  affordance (`.sub-card`, a `.card-chev`, a hover state). `accounts.eta`
  and `admin-feedback.eta` still have the plain form.
- Eta 3 has **no comment tag**: `<%# ... %>` compiles the `#` into the
  generated function and throws "Bad template syntax" at render, which
  typecheck and the test suite won't catch because no test renders every
  view. Use `<% /* ... */ %>` if a template really needs a note — though the
  views here carry none, and the reasoning lives next to the CSS or in the
  route instead.
- The vault's mail read is now **scoped by sender, not by a clock** (ADR
  0007), which reverses the `SINCE` note above: with a 7-day window, `SINCE`
  being day-granular costs nothing, so the search really is pushed down to
  the server as `FROM <mailFrom> SINCE <date>`. The earlier
  sequence-number-tail approach is gone. The exact cutoff is still applied
  in memory, because `SINCE` ignores the time of day and returns up to a day
  more than asked — and so is the sender match, since it is the whole
  privacy boundary and must not depend on a server's reading of the query.
- ImapFlow's `fetch()` accepts a `SearchObject` as its range, so
  `fetch({from, since}, ...)` works in one call — **don't**. Search first,
  then fetch the UIDs it returns: that's the only way to cap the work, and a
  sender with 300 messages in the window would otherwise all be fetched and
  MIME-parsed before anything could trim them. UIDs ascend with arrival, so
  `uids.slice(-20)` is the newest 20. Note `search()` returns
  `number[] | false | undefined`, so `Array.isArray` before using it.
- Anything that reaches an **IMAP command** needs shape validation like
  anything reaching an HTML attribute: `mailFrom` is checked against
  `/^[a-z0-9._%+-]+(?:@[a-z0-9._-]+)?$/` and rejected if it doesn't match,
  rather than escaped, because a quote or a CRLF in a SEARCH argument is the
  injection. Same rule as the `#rrggbb` and `http(s)` link checks — the list
  of "untrusted input that must be validated for shape" now has three
  entries, in three different sinks.
- When a feature's job is "let a person find something in an email", render
  the email and stop. The vault's mail list shows sender, subject and age,
  and the body opens in a `<dialog>` on click — no snippet, no extraction,
  nothing to be wrong about. It is less code than the snippet-plus-code
  version it replaced (two functions and a constant deleted, one added) and
  it reads better, because the reader has the whole message. The privacy
  boundary was never the truncation; it is the sender filter, which is
  unchanged. Note the body is written into the page by Eta's `<%= %>` and
  **never** through `JSON.stringify` into a `<script>` the way
  `calendar.eta` passes `returnTo`: a mail body is the one string in this
  app authored by an outsider, and a literal `</script>` inside it would end
  the block. HTML-escaping in an HTML context is the safe sink; keep it
  there.
- A `<button>` reusing the `.card` look needs the base `button` rule undone
  explicitly — `margin-top`, the pill `border-radius`, the accent fill,
  `font-weight: 800` and centred text all inherit and all look wrong. See
  `.mail-card` in `layout.eta`, which joins `.sub-card`'s hover-lift
  selectors rather than inventing a second affordance idiom.
- Linkifying text you did not write is three small decisions, not one regex.
  `toBodyParts` in `app/src/lib/mailbox.ts`: (1) **trailing punctuation goes
  back in the text** — "Verify at https://x.test/a." must not link to a URL
  ending in a full stop, and a closing bracket counts only if the URL opened
  one; (2) **the label is host plus path, never the whole URL** — the
  tracking query on a real Netflix link runs to 446 characters and buries
  the host, which is the one part worth reading before pressing, with the
  full URL kept in `href` and `title`; (3) **match case-insensitively** —
  the first version missed a body that wrote `HTTP://`, rendering it as dead
  text. Note `new URL` punycodes a non-ASCII host, and the label deliberately
  keeps that form: an IDN shown in its own script is how a lookalike domain
  passes for the real one.
- The test worth writing for any splitter that sits in front of a reader is
  that **the parts, concatenated, are the input** — see "loses no character
  of the body outside the links themselves". It catches the whole class of
  off-by-one slicing bug that would silently rewrite somebody's email, which
  per-case assertions miss. The one documented exception is the punycoded
  href, and it has its own test saying so.
- Checking that markup can't escape a template means rendering **hostile
  input**, not reading the code: feeding a mail body of
  `<img src=x onerror=alert(1)>` and `"><a href=javascript:alert(2)>` through
  the real `render()` showed every character escaped. Watch what you grep
  for afterwards, though — "onerror=alert" is *present* in that page, inside
  `&lt;img src=x onerror=alert(1)&gt;`, and is inert. Assert on the escaped
  form or read the fragment; a naive substring check reports a false alarm.
- Adding a page a friend should be able to reach means adding (or
  extending) an entry in `FEATURES` in `app/src/lib/features.ts`. Without
  one, the page is family only. That's deliberate; don't work around it
  with a per-route exception.
