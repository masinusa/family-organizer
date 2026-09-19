# Security Policy

This repository holds infrastructure and application code only. No family
data, calendar contents, or credentials are ever committed here — access to
the running app is gated by Identity-Aware Proxy (IAP) and a Google Group,
independent of the code being public. See
[docs/threat-model.md](docs/threat-model.md).

## Reporting a Vulnerability

Email spicerdefamily@gmail.com with details. This is a hobby project
maintained in spare time — best-effort response, no guaranteed SLA.

## Rules

- Never commit `*.tfvars`, `backend.hcl`, Terraform state, or service account
  keys. `.gitignore` and pre-commit gitleaks scanning both guard against
  this, but treat them as a backstop, not a substitute for care.
- Authentication to GCP from CI uses Workload Identity Federation only — no
  long-lived JSON keys should ever exist for this project.
