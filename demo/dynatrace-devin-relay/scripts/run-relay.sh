#!/usr/bin/env bash
#
# run-relay.sh — start the Dynatrace->Devin relay, loading .env if present.
#
# Usage:
#   ./scripts/run-relay.sh            # loads ./.env (if it exists), then starts
#   DRY_RUN=1 ./scripts/run-relay.sh  # start without calling the Devin API
#
# Copy .env.example to .env and fill in DEVIN_API_BASE / DEVIN_API_TOKEN for a
# live run. With DRY_RUN=1 no credentials are needed.

set -uo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo "[run-relay] loading .env"
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

exec node server.js
