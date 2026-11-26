# ADR 0007: Subscription vault — Secret Manager for passwords, IMAP for one-time codes

## Status

Accepted

## Context

Knowing which services the family pays for, what each is registered to, and
how to actually get into one was entirely in one person's head. Three
requests kept landing on the same person: "what do we subscribe to?", "what's
the password for X?", and "a code just went to the family email, can you read
it out?". The vault (`/subscriptions`) answers all three in the app, behind
the existing IAP + `users` boundary.

That means the app now has to hold two things it never has before: shared
service passwords, and a way to read a shared mailbox. Both are new kinds of
secret for a repo whose threat model previously boasted that "nothing in this
repo's code path ever sees a password or a long-lived credential".

### Where passwords live

Three options:

1. **Plaintext in Firestore.** Rejected outright — every Firestore read path,
   export, and backup would then carry credentials, and the runtime SA
   already has broad `roles/datastore.user`.
2. **Encrypted in Firestore with a Cloud KMS key.** Workable, but it puts
   ciphertext in the same documents the rest of the app lists freely, adds an
   envelope-encryption code path to get wrong, and gets no versioning or
   access audit for free.
3. **Google Secret Manager, one secret per subscription.** Firestore holds
   only a `hasPassword` flag; the value is addressed by a name derived from
   the doc id. Versioning, Cloud Audit Logs on every access, and IAM scoping
   all come from the service.

### How a shared mailbox gets read

The obvious choice would be the Gmail API, but it does not fit here:

- `https://www.googleapis.com/auth/gmail.readonly` is a **restricted** scope.
  Publishing an external app that uses it requires a CASA third-party
  security assessment — disproportionate for one family mailbox.
- Leaving the OAuth app in "testing" status instead avoids that, but refresh
  tokens for an unpublished app **expire after 7 days**, so the feature would
  silently break every week until someone re-consented.
- `gmail.metadata` is merely *sensitive* rather than restricted, but returns
  headers only — no body, and therefore no one-time codes. It doesn't do the
  job.
- Domain-wide delegation is unavailable for the same reason it was in ADR
  0006: family members use personal Gmail, not a Workspace/Cloud Identity
  org.

Gmail's **IMAP interface with an app password** sidesteps all of that: no
OAuth app to publish, no assessment, no expiring token.

## Decision

**Passwords: Secret Manager, keyed off the Firestore doc id.** The secret id
is derived (`sub-{docId}`), not stored, so there is no second name to drift
out of sync; Firestore auto-ids are 20 chars of `[A-Za-z0-9]` and always
valid as a secret id. `app/src/lib/secret-store.ts` talks to the REST API
through `google-auth-library` — already a dependency, and the same approach
`iap-access.ts` takes — rather than pulling in the gRPC
`@google-cloud/secret-manager` client. `hasPassword` on the Firestore doc is
flipped only *after* a version really lands, so the vault can never advertise
a password it cannot produce.

**Saving a password is for anyone on the access list, and keeps the old
one.** A password that only an admin can change is a vault that goes stale
the moment someone rotates a password at the service itself — and anyone who
can collect the current password can already do that. So the save form is
open to everyone on the list, and each save adds a Secret Manager version
rather than replacing one. A `passwords/{version}` subcollection records
*who* saved each version and when (Secret Manager knows the when, never the
who), and the subscription's page lists that history with a per-version
"get this one". Old passwords are kept because something is usually still
signed in with one: a TV, a console, a phone that never took the new
password. Because that subcollection is the index the history is built from,
the app never lists versions out of Secret Manager and needs no
`secretmanager.versions.list` permission; a version is only accepted from a
form if it appears in that history, so a submitted value can't address some
other secret's versions.

The runtime SA gets a narrow custom role
(`google_project_iam_custom_role.subscription_secret_manager`,
`infra/terraform/secrets.tf`) rather than `roles/secretmanager.admin`,
following the `iap_access_manager` precedent.

**Service mail: Gmail IMAP with an app password, scoped to one sender.**
`app/src/lib/mailbox.ts` connects to `imap.gmail.com:993` and opens INBOX
**read-only**, so collecting a code never changes what the mailbox owner
sees as unread.

What bounds the read is the **sender**, not the clock. A subscription
carries a `mailFrom` — an address or domain like `netflix.com` — and the
search is `FROM <mailFrom> SINCE <7 days ago>`, server-side. Without a
`mailFrom` a subscription offers no mail button at all, even when it is
registered to the family mailbox: there is no unfiltered path. A week of one
service's mail exposes far less of a shared mailbox than fifteen unfiltered
minutes did, which is why the window could widen from minutes to days at the
same time as the exposure narrowed.

The list renders sender + subject + age; the message itself opens in a
modal on click, carrying the whole `text/plain` body (capped at 10,000
characters, which the modal says when it bites). The HTML alternative is
discarded at parse time and never rendered — the body reaches the page as
escaped text in a `<pre>`, so a mail that contains markup displays it rather
than running it.

URLs in that body are rendered as real links rather than text to copy,
because a verify-or-reset link is half of what the window exists for. The
splitter hands the view *data* — text runs and `{href, label}` pairs — and
the view builds the anchor, so no markup ever originates in a message: only
`http(s)` is matched and the protocol is re-checked after parsing, the
label is host-plus-path (the tracking query on these runs to hundreds of
characters and buries the host, which is the part worth reading before
pressing), the full URL stays in `href` and `title`, and the anchor carries
`target="_blank" rel="noopener noreferrer nofollow"`. A non-ASCII host is
shown punycoded, since an IDN rendered in its own script is how a lookalike
domain passes for the real one.

This replaced a deliberately smaller render — a 180-character snippet plus a
guessed one-time code — which read worse *and* was wrong: the guess was a
standalone 4-8 digit run, and on real Netflix mail it returned the last four
digits of the support phone number and a segment of a UUID in a help URL,
both of them sitting ~1500 characters past the end of the snippet shown
beside them. The snippet was supposed to be what made a bad guess obvious,
and structurally it could not be. Showing the message and letting a reader
find their own code is less code and no guessing; the privacy boundary was
never the truncation, it is the sender.

Both filters are re-applied in
memory after the fetch: `SINCE` ignores the time of day and so returns up to
a day more than asked, and the sender match is now the entire privacy
boundary, so a page promising "Netflix mail" must not render unrelated
private mail because a server interpreted a search differently. `mailFrom`
is validated to an address-or-domain shape before it is ever compiled into
an IMAP command — a space, quote or newline is rejected, not escaped.
Nothing is persisted and nothing but counts is logged.

The app password itself is a **Terraform-managed secret container with no
version resource**: the value is added once by hand with
`gcloud secrets versions add`, exactly as the IAP OAuth client secret is kept
in IAP's own settings and out of Terraform state and this repo (ADR 0002).

**Every reveal is audited and shown.** A `reveals` subcollection records who
took a password (and which version of it) or read recent mail, and the
subscription's page lists the most recent. Letting anyone on the access list
take a shared credential without asking is the whole point of the feature;
the honest counterpart is that doing so is on the record.

## Consequences

- The threat model's "no passwords, no long-lived credentials" claim no
  longer holds and has been updated. The mailbox app password in particular
  is a long-lived, mailbox-wide credential — it grants full IMAP access to
  that mailbox, not just the one sender and one week the UI exposes.
  Rotating it means minting a new app password and adding a new secret
  version; no code or deploy is involved.
- The runtime SA can now read **every** secret in the project, since
  `secretmanager.versions.access` is granted project-wide. The project holds
  nothing else, which is what makes that acceptable today; `secrets.tf`
  carries a note to split it with an IAM condition on
  `resource.name.startsWith(".../secrets/sub-")` if that stops being true.
- Vault access to a subscription registered to the family mailbox implies
  read access to that mailbox — but only to mail **from that
  subscription's own sender**, and only the last 7 days of it. The earlier
  shape of this feature showed 15 unfiltered minutes of the inbox and
  recorded "whatever it happens to be about" as an accepted risk; scoping
  the search to `mailFrom` closes that, and is the reason the window could
  grow to a useful length. What remains is narrower and precisely stated: a
  family member on Netflix's access list can read a week of Netflix's mail
  to that mailbox, including anything else that sender happens to send.
- The sender is admin-set per subscription and unvalidated against reality —
  nothing stops `mailFrom` being set to a *person's* address rather than a
  service's, which would turn that subscription's page into a reader for
  that correspondent's mail to the shared mailbox. It is an admin-only
  field, every read is on the record, and the access list is still the
  boundary; but it is a sharper tool than the 15-minute window was, and
  pointing it at a person is a deliberate act rather than something the code
  can catch.
- Two new runtime dependencies, `imapflow` and `mailparser`. Hand-rolling
  MIME parsing to avoid the second was considered and rejected as a worse
  risk than the dependency. ADR 0005 has already picked the stack, so
  AGENTS.md's "no dependencies in the `app/` placeholder" freeze no longer
  applies.
- Local dev splits along the line the two dev scripts already draw:
  `scripts/dev-local.sh` (Firestore emulator) gets an in-process in-memory
  secret store — versioned like the real one, so the password history is
  clickable too — and the whole flow stays usable with no GCP project behind
  it, while `scripts/dev-local-real.sh` reaches the real Secret Manager
  through the developer's own ADC. This is keyed off `FIRESTORE_EMULATOR_HOST`
  rather than a new flag, so neither script needed a new switch. Note the
  consequence: a password saved under `dev-local-real.sh` is the real one.
- Keeping old passwords means a password rotated *because it leaked* is
  still readable in the app by everyone on that subscription's access list.
  That is accepted: the access list is the boundary the whole vault rests
  on, and a stale password nobody can look up is how a family member ends up
  locked out of the TV. Destroying a version in Secret Manager by hand
  removes the value for good; the history row stays and the page then says
  that version can't be read.
- Any family member on the list can now change what the vault hands out to
  everyone else, including overwriting what an admin stored. The history is
  the control: who changed it and when is on the page, and nothing they
  replace is actually lost.
- Deleting a subscription deletes its Firestore doc, reveals and password
  history first, then best-effort deletes the secret — the same ordering and
  the same "log it, don't fail the user-visible action" rule as `deleteUser`'s IAP
  revoke in ADR 0006. A stranded secret is inert (nothing addresses it) but
  does linger.
