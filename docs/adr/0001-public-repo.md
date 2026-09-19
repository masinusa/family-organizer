# ADR 0001: Make this repository public

## Status

Accepted

## Context

This is a personal/family project, but the code needs to live somewhere
version-controlled and CI-able. The alternative to a public repo is a
private one, which would need per-collaborator access management on GitHub
itself and loses the benefit of the code being reviewable/reusable by
anyone.

## Decision

Keep the repository public. Security comes from the architecture, not from
hiding source:

- No long-lived credentials ever need to exist (Workload Identity
  Federation for CI, Identity-Aware Proxy for the running app).
- Access to the actual running app and its data is gated by IAP plus a
  Google Group, entirely independent of who can read the code.
- Pre-commit and CI gitleaks scanning catch accidental secret commits
  before they land.

## Consequences

- Every commit is world-readable, forever (even after a force-push or
  revert) — there's no "delete it later" safety net for an accidental
  secret. This raises the bar on care taken with `.gitignore` and
  pre-commit, but doesn't introduce risk to the family's actual data, which
  never lives in this repo.
- Anyone can fork the infrastructure design for their own family/project —
  considered a benefit, not a cost.
