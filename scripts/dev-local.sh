#!/usr/bin/env bash
set -euo pipefail

# Homebrew's openjdk is keg-only; the Firestore emulator needs java on PATH.
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"

REPO_ROOT="$(git rev-parse --show-toplevel)"
PORT=3000
URL="http://localhost:${PORT}"
PID_FILE="/tmp/family-organizer-dev.pid"
LOG_FILE="/tmp/family-organizer-dev.log"

if curl -s -o /dev/null "$URL"; then
  echo "Already running at $URL"
  exit 0
fi

# Start the Firestore emulator only if it isn't already running.
if ! curl -s -o /dev/null http://localhost:8085; then
  gcloud emulators firestore start --host-port=localhost:8085 > /tmp/firestore-emulator.log 2>&1 &
  echo "Waiting for Firestore emulator..."
  until curl -s -o /dev/null http://localhost:8085; do
    sleep 1
  done
fi
echo "Firestore emulator ready on :8085"

cd "$REPO_ROOT/app"
FIRESTORE_EMULATOR_HOST=localhost:8085 GOOGLE_CLOUD_PROJECT=family-organizer-dev DEV_USER_EMAIL=masinusa@gmail.com PORT=$PORT \
  nohup npm run dev > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

echo "Waiting for dev server..."
until curl -s -o /dev/null "$URL"; do
  sleep 1
done

echo "Running at $URL"
