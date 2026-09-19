# ADR 0004: GitHub Actions authenticates via Workload Identity Federation

## Status

Accepted

## Context

GitHub Actions needs to authenticate to GCP to build/push images and deploy
Cloud Run revisions. The traditional approach — a service account JSON key
stored as a GitHub secret — is a long-lived credential that can leak (in
logs, in a compromised Action, in a fork) and needs manual rotation.

## Decision

Use Workload Identity Federation (WIF) instead:

- A Workload Identity Pool + OIDC provider trusts GitHub's own OIDC token
  issuer (`token.actions.githubusercontent.com`).
- The provider's `attribute_condition` is locked to this exact repository
  (`assertion.repository == "masinusa/family-organizer"`) — this is the
  key security property: only workflow runs from this repo can obtain a
  token.
- A dedicated `deployer` service account (not a human's account, not the
  default compute SA) is granted `roles/iam.workloadIdentityUser` scoped
  to that repo-restricted principal set, plus the minimum project/resource
  roles it needs to push images and deploy Cloud Run revisions.
- No service account key ever exists for this project.

## Consequences

- Slightly heavier one-time setup than pasting a JSON key into GitHub
  secrets — but Terraform creates the entire pool/provider/binding, and
  exposes exactly what CI needs (`WIF_PROVIDER`, `DEPLOYER_SA`) as outputs
  to copy into GitHub repository variables (not secrets — neither value is
  sensitive on its own, which is part of the point of WIF).
- If the repo is ever renamed or forked to a new owner/name, the
  `attribute_condition` (and `github_repo` variable) must be updated and
  re-applied, or CI will stop being able to authenticate.
