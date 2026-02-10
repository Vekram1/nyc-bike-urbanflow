#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

ROOT="$(repo_root)"
cd "$ROOT"
load_default_envs

require_cmd bun

export URBANFLOW_API_ORIGIN="${URBANFLOW_API_ORIGIN:-http://127.0.0.1:3000}"
export SYSTEM_ID="${SYSTEM_ID:-citibike-nyc}"
export NEXT_PUBLIC_SYSTEM_ID="${NEXT_PUBLIC_SYSTEM_ID:-$SYSTEM_ID}"
PORT_BASE="${PORT:-3001}"

if [[ -z "${NEXT_PUBLIC_MAPBOX_TOKEN:-}" ]]; then
  die "NEXT_PUBLIC_MAPBOX_TOKEN is required (set apps/web/.env.local or env var)"
fi

require_cmd lsof

choose_port() {
  local p="$1"
  local max_tries=20
  local i=0
  while [[ "$i" -lt "$max_tries" ]]; do
    if ! lsof -iTCP:"$p" -sTCP:LISTEN -Pn >/dev/null 2>&1; then
      echo "$p"
      return 0
    fi
    p=$((p + 1))
    i=$((i + 1))
  done
  return 1
}

PORT="$(choose_port "$PORT_BASE")" || die "Could not find an open port from ${PORT_BASE}..$((PORT_BASE + 19))"
if [[ "$PORT" != "$PORT_BASE" ]]; then
  warn "Port $PORT_BASE in use, falling back to $PORT"
fi
export PORT

log "Starting web on port ${PORT}"
if bun run --help >/dev/null 2>&1; then
  exec bun run --cwd apps/web dev
fi

# Fallback for older bun flag parsing variants.
exec bun --cwd apps/web run dev
