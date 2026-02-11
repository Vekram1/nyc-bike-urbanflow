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
export POLICY_DEFAULT_VERSION="${POLICY_DEFAULT_VERSION:-rebal.greedy.v1}"
export POLICY_AVAILABLE_VERSIONS="${POLICY_AVAILABLE_VERSIONS:-rebal.greedy.v1,rebal.global.v1}"
export POLICY_WORKER_ENABLED="${POLICY_WORKER_ENABLED:-1}"

if command -v shasum >/dev/null 2>&1; then
  db_hash="$(printf '%s' "$DATABASE_URL" | shasum -a 256 | awk '{print $1}' | cut -c1-12)"
  log "DATABASE_URL hash: ${db_hash}"
fi

if ! bun -e 'JSON.parse(process.env.SV_KEY_MATERIAL_JSON || "")' >/dev/null 2>&1; then
  candidate="${SV_KEY_MATERIAL_JSON%?}"
  if SV_KEY_MATERIAL_JSON="$candidate" \
    bun -e 'JSON.parse(process.env.SV_KEY_MATERIAL_JSON || "")' >/dev/null 2>&1; then
    warn "SV_KEY_MATERIAL_JSON had a trailing character; auto-correcting for this run."
    export SV_KEY_MATERIAL_JSON="$candidate"
  else
    die "SV_KEY_MATERIAL_JSON is invalid JSON. Current value: ${SV_KEY_MATERIAL_JSON}"
  fi
fi

log "Starting API on ${API_HOST}:${API_PORT}"
if [[ "$POLICY_WORKER_ENABLED" == "1" ]]; then
  log "Starting policy worker (POLICY_WORKER_ENABLED=1)"
  bun packages/api/src/policy/worker.ts &
  policy_worker_pid="$!"
  # Fail fast if worker crashes on boot (commonly DB/env issues).
  sleep 1
  if ! kill -0 "$policy_worker_pid" >/dev/null 2>&1; then
    die "Policy worker failed to start. Check DATABASE_URL/Postgres and run scripts/dev/start-policy-worker.sh for logs."
  fi
  cleanup() {
    if [[ -n "${policy_worker_pid:-}" ]] && kill -0 "$policy_worker_pid" >/dev/null 2>&1; then
      kill "$policy_worker_pid" >/dev/null 2>&1 || true
      wait "$policy_worker_pid" >/dev/null 2>&1 || true
    fi
  }
  trap cleanup EXIT INT TERM
fi

bun packages/api/src/server.ts
