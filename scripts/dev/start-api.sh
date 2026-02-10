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
export SV_KEY_MATERIAL_JSON="${SV_KEY_MATERIAL_JSON:-{\"k1\":\"dev-secret\"}}"
export API_HOST="${API_HOST:-0.0.0.0}"
export API_PORT="${API_PORT:-3000}"

log "Starting API on ${API_HOST}:${API_PORT}"
exec bun packages/api/src/server.ts

