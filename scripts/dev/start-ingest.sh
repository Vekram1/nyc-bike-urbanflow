#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

ROOT="$(repo_root)"
cd "$ROOT"
load_default_envs

require_cmd bun

export DATABASE_URL="${DATABASE_URL:-postgres://urbanflow:urbanflow@127.0.0.1:5432/urbanflow}"
export SYSTEM_ID="${SYSTEM_ID:-citibike-nyc}"
export SEVERITY_VERSION="${SEVERITY_VERSION:-sev.v1}"
export PRESSURE_PROXY_METHOD="${PRESSURE_PROXY_METHOD:-delta_cap.v1}"

log "Starting ingest poller for system_id=${SYSTEM_ID}"
exec bun packages/ingest/src/cli.ts \
  --system "$SYSTEM_ID" \
  --poll \
  --load-db \
  --refresh-serving \
  --severity-version "$SEVERITY_VERSION" \
  --pressure-proxy-method "$PRESSURE_PROXY_METHOD"

