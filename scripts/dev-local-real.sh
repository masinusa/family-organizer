#!/usr/bin/env bash
set -euo pipefail

# Like dev-local.sh, but skips the Firestore emulator entirely and points
# the dev server at the real Firestore database in GCP. Use this when you
# want local changes to read/write actual data instead of the emulator's
# in-memory store (which is wiped every time it stops).
#
# WARNING: this is the same Firestore database the deployed app at
# spicers.family uses. Anything you create, edit, or delete here is real
# family data, not a sandbox.

REPO_ROOT="$(git rev-parse --show-toplevel)"
PROJECT_ID="elevated-server-509103-u5"
PORT=3000
URL="http://localhost:${PORT}"
PID_FILE="/tmp/family-organizer-dev-real.pid"
LOG_FILE="/tmp/family-organizer-dev-real.log"

if curl -s -o /dev/null "$URL"; then
  echo "Already running at $URL"
  exit 0
fi

if ! gcloud auth application-default print-access-token > /dev/null 2>&1; then
  echo "No Application Default Credentials found." >&2
  echo "Run: gcloud auth application-default login" >&2
  exit 1
fi

echo "Connecting to REAL Firestore in project ${PROJECT_ID} (not the emulator)."

cd "$REPO_ROOT/app"
unset FIRESTORE_EMULATOR_HOST
GOOGLE_CLOUD_PROJECT=$PROJECT_ID DEV_USER_EMAIL=masinusa@gmail.com PORT=$PORT \
  nohup npm run dev > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

echo "Waiting for dev server..."
until curl -s -o /dev/null "$URL"; do
  sleep 1
done

echo "Running at $URL (real Firestore)"
