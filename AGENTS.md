# AGENTS.md

Conventions for any agent (or human) working in this repo.

## Before you start

Read [`docs/knowledge-base.md`](docs/knowledge-base.md) — it's a running log
of pitfalls hit, decisions made, and guidelines learned while building this
repo. Check it before making infra or architecture changes so you don't
repeat a mistake already found.

## While you work

- Append to `docs/knowledge-base.md` whenever you hit a non-obvious pitfall
  or make a decision worth remembering — a new bullet under the relevant
  section (`Pitfalls`, `Decisions`, or `Guidelines`), newest last. Don't
  rewrite or reorganize existing entries.
- Run `terraform fmt -recursive` and `terraform validate` in
  `infra/terraform/` before committing any Terraform change.
- Never commit `*.tfvars`, `backend.hcl`, Terraform state, or any service
  account key. These are gitignored; don't work around that.
- Keep `app/` minimal until a stack ADR (`docs/adr/`) picks the real
  framework — don't add a framework or dependency to the placeholder without
  writing that ADR first.
- Prefer editing existing files over rewriting them; prefer reusing an
  existing Terraform resource/variable over adding a new one that duplicates
  it.
- This repo is public. Treat every commit as world-readable: no real family
  emails, calendar data, or credentials, ever — placeholders and examples
  only.
- Don't use browser automation (e.g. Claude in Chrome) or spin up the dev
  server yourself to manually click through a feature you just built —
  it burns time and tokens. Verify with typecheck/tests instead, then ask
  the user to run it locally (`scripts/dev-local.sh` or
  `scripts/dev-local-real.sh`) and try it themselves.

## Fail fast; no fallbacks, no legacy

There is one deployment, one dataset, and one supported version of
everything here. Code that quietly tolerates an older shape of the world
is dead weight, and it hides real bugs behind plausible-looking defaults.

- **No back-compat shims for our own data.** When a Firestore document
  shape changes, migrate the collection or clear it — don't add read-time
  defaults so documents written before the change still load. A field
  that should be there and isn't is a bug, and it should surface as one.
- **Don't paper over unexpected values.** Coercing an unrecognised enum to
  a default, or `?? ""`-ing away something that should always be present,
  turns a loud failure into a silently wrong answer. Throw, or let it
  throw.
- **Target current runtimes only.** Node 22+ and current evergreen
  browsers. No polyfills, no transpile targets for older engines, no
  feature detection for things our browsers already have (`:has()`,
  `<dialog>`, `fetch`, `color-mix()`), and no `<noscript>` or
  no-JavaScript fallback paths — the app already requires JavaScript.
- **Delete what you replace.** When a new path supersedes an old one,
  remove the old one in the same change instead of leaving both wired up
  "just in case". Two live paths means two things to reason about and one
  of them is untested.

The one exception is **untrusted input**, which must still be validated
and rejected explicitly — that *is* failing fast. Rejecting a bad request
with a 4xx, or refusing a colour that isn't `#rrggbb` before it reaches a
`style` attribute, is required; silently substituting a default for it is
what this section forbids. See [`docs/threat-model.md`](docs/threat-model.md).
