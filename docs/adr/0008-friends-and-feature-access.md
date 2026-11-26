# ADR 0008: Friends, and an access gate that fails closed

## Status

Accepted

## Context

Until now, everyone who could sign in was family: on the tree, and able to
open every page. `requireFamilyMember` checked that an account existed and
that was the whole of authorization, apart from `requireAdmin` and the
vault's per-subscription access list.

A Secret Santa changes that. Some people taking part aren't family. They
need to sign in, see their assignment, and nothing else. They shouldn't be
on the tree, offered as event attendees, or see the calendar or the vault.
The same will be true of whatever comes next on the Christmas page.

Two questions:

1. **How is a friend represented?**
2. **How does every page decide whether a friend can open it?**

## Decision

### A friend is a person with `circle: "friend"` and an account with role `friend`

Not a separate collection. The site already draws every human through one
`Persona` (`app/src/lib/persona.ts`), joined from `people` and `users` by
email. A friend needs everything a persona gives: a face, a name, an
account. A second collection would mean a second join and a second set of
partials, and every picker would have to merge two lists.

So `PersonDoc` gains `circle: "family" | "friend"`, `UserRole` gains
`friend`, and `UserDoc` gains `optIns: FeatureKey[]`. `PersonaDirectory`
refuses a friend account on a family person and the reverse. Otherwise the
role (which the gate reads) and the circle (which the tree reads) could
disagree about one person. The directory's `all()` and `active()` return
family only, so the tree, the accounts list and every roster that existed
before friends stay family-only without changes at each call site.

### Every feature declares its audience; an unclaimed path is family only

`app/src/lib/features.ts` lists every feature once with the path prefixes it
owns. `requireFeatureAccess` (`app/src/middleware/feature-access.ts`) runs
ahead of every feature router and applies one rule:

- Family accounts get every feature.
- A friend gets a feature if an admin opted them into it (`optIns`), or if
  they take part in it (the Christmas page, once a Secret Santa exists).
- **A path no feature claims is family only.**

The last point is the decision that matters. The alternative, a guard on
each route, fails open: a page added later without the guard is visible to
every friend. With the registry, forgetting to register a page keeps
friends out, which is the safe direction to fail. It's also why `/friends`
and `/admin/*` are deliberately unregistered.

Per-record checks stay in the routes (`canView` for a subscription,
participation for a specific exchange). The gate only answers whether this
viewer may be in this part of the site at all.

## Consequences

- A friend who signs in at `/` without the calendar is redirected to the
  first feature they can open, rather than shown a 403.
- People pickers use `PersonaDirectory.audience(key)`: family accounts plus
  friends opted into that feature. A friend opted into the calendar can be
  an attendee, and a friend opted into the vault can be put on a
  subscription. A friend opted into neither can be neither.
- An account can't move between family and friend
  (`CROSS_CIRCLE_ERROR`). Promoting a friend to family means removing them
  and adding them to the tree. This is rare enough not to need a flow.
- Existing data needs `npm run migrate:circles` once: every person becomes
  family, and every account gets `optIns: []`. The repos throw on a document
  missing either field rather than defaulting it.
