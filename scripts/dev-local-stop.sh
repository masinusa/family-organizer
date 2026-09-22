#!/usr/bin/env bash
set -euo pipefail

PID_FILE="/tmp/family-organizer-dev.pid"
PID_FILE_REAL="/tmp/family-organizer-dev-real.pid"

stop_port() {
  local port="$1"
  local name="$2"
  local pids
  pids="$(lsof -ti "tcp:${port}" || true)"
  if [[ -z "$pids" ]]; then
    echo "${name} not running on :${port}"
    return
  fi
  # npm run dev spawns a child process, so kill everything on the port.
  echo "$pids" | xargs kill
  echo "Stopped ${name} on :${port}"
}

stop_port 3000 "dev server"
stop_port 8085 "Firestore emulator"

rm -f "$PID_FILE" "$PID_FILE_REAL"
