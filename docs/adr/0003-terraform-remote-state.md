# ADR 0003: Terraform state in a GCS bucket created outside Terraform

## Status

Accepted

## Context

Terraform needs somewhere to store its state file that isn't local disk (so
state survives across machines/CI runs) and isn't world-readable (state can
contain resource IDs and configuration details). The natural place is a GCS
bucket — but Terraform can't create the very bucket it will then use as its
own backend without a chicken-and-egg bootstrapping problem.

## Decision

- `scripts/bootstrap.sh <project-id>` creates the state bucket
  (`<project-id>-tfstate`) directly via `gcloud`, before Terraform is ever
  initialized: uniform bucket-level access, public access prevention, and
  object versioning enabled.
- `infra/terraform/versions.tf` declares an empty `backend "gcs" {}` block;
  the actual bucket/prefix are supplied at `terraform init
  -backend-config=backend.hcl` time, from a gitignored `backend.hcl` (see
  `backend.hcl.example`).
- The bucket itself is never a Terraform resource — it can't safely manage
  the state it's currently sitting in.

## Consequences

- Versioning gives a recovery path if state is ever corrupted or a bad
  `apply` needs to be diagnosed against a prior state.
- Public access prevention + uniform bucket-level access mean the bucket
  can't be accidentally made public via legacy ACLs.
- Anyone re-running the quick start on a new project must run
  `bootstrap.sh` first — this is documented in the README's quick start, in
  that order, specifically to avoid the bootstrapping problem.
