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
        |
        +--> Firestore (events, users, people, feedback, subscriptions)
        +--> Secret Manager (subscription passwords; mailbox app password)
        +--> Gmail IMAP, read-only (recent mail in the shared family mailbox)
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

**Correction:** the two tables above describe the original design, not the
code. Attendees are *not* a subcollection — they are a denormalised
`attendees` array of `{email, name, status}` maps on the event document
itself, because the only query needed is "render this event" and a family
event has single-digit attendees. See the Decisions entries in
`docs/knowledge-base.md` for the current shape.

**`users/{email}`** (top-level collection, doc ID is the lowercased email)

| field     | notes                                    |
| --------- | ------------------------------------------ |
| role      | enum: admin / member / friend             |
| optIns    | feature keys a friend may open; `[]` for family |
| createdAt |                                            |
| updatedAt |                                            |

A `friend` account belongs to a `people` doc with `circle: "friend"`:
someone who signs in for a specific feature without being on the tree.
Which pages a friend can open is decided by `app/src/lib/features.ts` and
the gate in `app/src/middleware/feature-access.ts`, which fails closed
(ADR 0008).

This is the entire identity/authorization system alongside IAP: a doc's
presence is what grants app access, and its existence also drives the
IAP-access grant itself (ADR 0006) — there's no separate credentials table
or external group to keep in sync.

**`feedback/{feedbackId}`** (top-level collection)

| field       | notes                                               |
| ----------- | --------------------------------------------------- |
| message     | Required free text, limited to 2,000 characters    |
| category    | enum: general / bug / idea                          |
| submittedBy | Email from the verified IAP identity                |
| status      | enum: new / reviewed / resolved                     |
| createdAt   | Server-generated Firestore timestamp                |
| updatedAt   | Server-generated Firestore timestamp                |

Feedback is submitted only through the authenticated app, stored privately
in Firestore, and reviewed by admins in the app. It is never automatically
sent to GitHub or email, so private family details do not escape the
application's existing access boundary.

**`subscriptions/{subscriptionId}`** (top-level collection)

| field        | notes                                                        |
| ------------ | ------------------------------------------------------------ |
| name         | Required, e.g. "Netflix"                                      |
| accountEmail | nullable, normalized; the address the *service* is registered to |
| accountPhone | nullable, free text                                           |
| link         | nullable sign-in URL, validated to http(s) before rendering   |
| notes        | nullable free text                                            |
| mailFrom     | nullable sender (address or domain) the family mailbox is searched for; validated to an address-or-domain shape, since it reaches an IMAP command |
| hasPassword  | boolean — whether a Secret Manager version exists             |
| memberEmails | array of normalized emails; who may see it and reveal secrets |
| createdBy    | Email from the verified IAP identity                          |
| createdAt    | Server-generated Firestore timestamp                          |
| updatedAt    | Server-generated Firestore timestamp                          |

**`subscriptions/{subscriptionId}/reveals/{revealId}`** (subcollection)

| field   | notes                                                            |
| ------- | ---------------------------------------------------------------- |
| email   | Email from the verified IAP identity, never a form field          |
| action  | enum: password / mail                                             |
| version | nullable Secret Manager version id — which stored password was taken; null means the current one |
| at      | Server-generated Firestore timestamp                              |

**`subscriptions/{subscriptionId}/passwords/{version}`** (subcollection)

| field   | notes                                                             |
| ------- | ----------------------------------------------------------------- |
| version | Secret Manager version id the value landed as; also the doc id     |
| setBy   | Email from the verified IAP identity, never a form field           |
| at      | Server-generated Firestore timestamp                               |

The password history: one document per save, holding **no password** — just
who saved it and when, keyed by the Secret Manager version that carries the
value. Secret Manager keeps every version and its create time but has no
idea who asked for the change, so this is the half it can't answer; it is
also the index the history list is built from, which is why the app never
needs `secretmanager.versions.list`. Anyone on the access list can save a
new password and read back any version in the history, since nothing is
overwritten — see ADR 0007.

Subcollections here, unlike attendees above, because the only queries are
genuinely ordered and limited ones: the most recent reveals, and the saves,
for one subscription.

**No password is ever stored in Firestore.** The value lives in Secret
Manager under `sub-{subscriptionId}` — a name derived from the document id,
not a second stored field — and `hasPassword` is the only trace of it in the
database. Saving a new one adds a version rather than replacing anything, so
an old password stays collectable for the device still signed in with it.
The shared family mailbox's IMAP app password is a separate secret
(`family-mailbox-app-password`), whose container Terraform creates but whose
value is added by hand and never appears in Terraform state or this repo.

A subscription lists only for family members on its `memberEmails`; admins
see all of them. Filtering happens in the app
(`app/src/lib/subscription-access.ts`), not in the Firestore query — see ADR
0007 and the knowledge base for why.

**`secretSantas/{year}`** (top-level collection, doc id is the year)

| field          | notes                                                         |
| -------------- | ------------------------------------------------------------- |
| year           | integer                                                       |
| budget         | nullable whole dollars, 1–10,000                              |
| exchangeDate   | nullable `"YYYY-MM-DD"` — a calendar day, not an instant      |
| participantIds | person ids: family with an account, or friends with an account and Christmas switched on |
| assignments    | map giver person id → receiver person id; `{}` until drawn    |
| drawnAt        | nullable Timestamp of the last draw (not of a hand edit)      |
| createdBy      | Email from the verified IAP identity                          |
| createdAt      | Server-generated Firestore timestamp                          |
| updatedAt      | Server-generated Firestore timestamp                          |

One exchange a year. `assignments` is the secret: routes read it only through
`app/src/lib/secret-santa.ts`, and each page carries the viewer's own pair
and nothing else. An admin sees the full map only by opening it on purpose
(`?all=1`), so running an exchange doesn't spoil it for them. A friend can
open `/christmas` exactly when they appear in some exchange's
`participantIds` (ADR 0008).

**`secretSantas/{year}/wishlists/{personId}`** (subcollection)

| field     | notes                                                          |
| --------- | -------------------------------------------------------------- |
| items     | array of `{text, link}`, at most 30; `link` is http(s) or null |
| updatedAt | Server-generated Firestore timestamp                           |

Keyed by person id, which the route takes from the viewer's persona and never
from the form, so you can only ever write your own list. A page carries
two lists at most: your own to edit, and your recipient's to read. The admin's
full assignment list doesn't include anyone's.

**`secretSantas/{year}/threads/{giverId}_{receiverId}`** (subcollection)

| field    | notes                                                               |
| -------- | ------------------------------------------------------------------- |
| messages | array of `{from: "santa" \| "recipient", text, at}`, at most 200    |

The anonymous notes between a Santa and their recipient. A message names a
side, never a person. The doc is keyed by the pair, so an admin changing an
assignment starts a fresh conversation, and the old Santa's notes never
reach a recipient they no longer have. Neither post route takes an id: the
server works out the pair from who's asking.
