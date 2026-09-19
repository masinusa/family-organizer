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
