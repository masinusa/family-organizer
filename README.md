# family-hub

A private family website for coordinating one shared calendar: a single
place the whole family can view and edit upcoming events.

Built on Google Cloud (Cloud Run + Identity-Aware Proxy), provisioned with
Terraform, deployed from GitHub Actions with no long-lived keys.

> **Status:** Phase 0, infrastructure skeleton. See [`docs/roadmap.md`](docs/roadmap.md).

## Why this repo is public

The code is open; the data and credentials are not. Security comes from the
architecture (IAP, deny-by-default authorization, scoped tokens, Workload
Identity Federation), not from hiding source. Read the
[threat model](docs/threat-model.md) and [ADRs](docs/adr/).

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the diagram and data
model.

## Repo layout

```
app/                 Application container (placeholder until stack ADR)
infra/terraform/     GCP infrastructure as code
scripts/             One-time bootstrap helpers
docs/                Architecture, threat model, roadmap, ADRs
.github/workflows/   CI (fmt/validate/secrets scan), CodeQL, deploy
```

## Quick start (infrastructure)

Prerequisites: a **dedicated** GCP project with billing, `gcloud`,
`terraform >= 1.9`, a Google Group for family access.

```bash
./scripts/bootstrap.sh <project-id>                 # private, versioned state bucket
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars        # fill in (gitignored)
cp backend.hcl.example backend.hcl                  # fill in (gitignored)
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

Then copy the `terraform output` values into GitHub repository **variables**
used by `deploy.yml`: `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_SERVICE_NAME`,
`AR_REPO`, `WIF_PROVIDER`, `DEPLOYER_SA`.

**One manual step Terraform can't do:** configure the IAP OAuth consent
screen once, in the Cloud Console (Security → Identity-Aware Proxy →
Configure Consent Screen on the `family-hub` service → External audience →
Auto-generate credentials). Google shut down the API that used to let
Terraform manage this in March 2026, so it's a one-time click-through — see
[`docs/adr/0002-gcp-cloud-run-iap.md`](docs/adr/0002-gcp-cloud-run-iap.md).
Until it's done, IAP will block everyone, including group members.

Pushes to `main` that touch `app/` build and roll out a new Cloud Run
revision automatically.

## Cost

Scale-to-zero Cloud Run, a small registry, and a state bucket. Expect low
single-digit dollars per month at family traffic; a budget alert is
provisioned. Verify against the GCP pricing calculator.

## Security

See [`SECURITY.md`](SECURITY.md). Never commit `*.tfvars`, state, keys, or
real family data. Pre-commit runs gitleaks; install with `pre-commit install`.

## License

MIT. See [`LICENSE`](LICENSE).
