#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <project-id> [region]" >&2
  exit 1
fi

PROJECT_ID="$1"
REGION="${2:-us-central1}"
BUCKET="${PROJECT_ID}-tfstate"

if ! command -v gcloud &>/dev/null; then
  echo "gcloud CLI not found. Install it first: https://cloud.google.com/sdk/docs/install" >&2
  exit 1
fi

ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)')"
if [[ -z "$ACTIVE_ACCOUNT" ]]; then
  echo "No active gcloud auth session. Run 'gcloud auth login' first." >&2
  exit 1
fi

echo "Using account: $ACTIVE_ACCOUNT"
gcloud config set project "$PROJECT_ID" >/dev/null

echo "Enabling bootstrap APIs..."
gcloud services enable \
  storage.googleapis.com \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  --project="$PROJECT_ID"

if gcloud storage buckets describe "gs://${BUCKET}" &>/dev/null; then
  echo "Bucket gs://${BUCKET} already exists, skipping creation."
else
  echo "Creating state bucket gs://${BUCKET} in ${REGION}..."
  gcloud storage buckets create "gs://${BUCKET}" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --uniform-bucket-level-access \
    --public-access-prevention
fi

echo "Enabling versioning on gs://${BUCKET}..."
gcloud storage buckets update "gs://${BUCKET}" --versioning

cat <<EOF

State bucket ready. Save this as infra/terraform/backend.hcl:

  bucket = "${BUCKET}"
  prefix = "terraform/state"

Then run:

  cd infra/terraform
  terraform init -backend-config=backend.hcl

EOF
