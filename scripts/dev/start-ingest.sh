#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

ROOT="$(repo_root)"
cd "$ROOT"
load_default_envs

require_cmd bun
require_cmd du
require_cmd awk

export DATABASE_URL="${DATABASE_URL:-postgres://urbanflow:urbanflow@127.0.0.1:5432/urbanflow}"
export SYSTEM_ID="${SYSTEM_ID:-citibike-nyc}"
export SEVERITY_VERSION="${SEVERITY_VERSION:-sev.v1}"
export PRESSURE_PROXY_METHOD="${PRESSURE_PROXY_METHOD:-delta_cap.v1}"
export GBFS_DATA_ROOT="${GBFS_DATA_ROOT:-data/gbfs}"
export PRUNE_INTERVAL_SECONDS="${PRUNE_INTERVAL_SECONDS:-900}"
export PRUNE_HIGH_WATER_GB="${PRUNE_HIGH_WATER_GB:-10}"
export PRUNE_LOW_WATER_GB="${PRUNE_LOW_WATER_GB:-9}"
export PRUNE_RETENTION_DAYS="${PRUNE_RETENTION_DAYS:-30}"

poll_pid=""
prune_pid=""

cleanup() {
  if [[ -n "$prune_pid" ]] && kill -0 "$prune_pid" >/dev/null 2>&1; then
    kill "$prune_pid" >/dev/null 2>&1 || true
    wait "$prune_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$poll_pid" ]] && kill -0 "$poll_pid" >/dev/null 2>&1; then
    kill "$poll_pid" >/dev/null 2>&1 || true
    wait "$poll_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

is_gt() {
  local lhs="$1"
  local rhs="$2"
  awk -v a="$lhs" -v b="$rhs" 'BEGIN { exit !(a > b) }'
}

current_archive_gb() {
  local data_root="$1"
  if [[ ! -d "$data_root" ]]; then
    echo "0"
    return 0
  fi
  du -sk "$data_root" | awk '{printf "%.6f", $1 / 1048576}'
}

run_prune_cycle_if_needed() {
  local current_gb
  current_gb="$(current_archive_gb "$GBFS_DATA_ROOT")"
  if is_gt "$current_gb" "$PRUNE_HIGH_WATER_GB"; then
    log "Archive size ${current_gb}GB > ${PRUNE_HIGH_WATER_GB}GB. Pruning to <= ${PRUNE_LOW_WATER_GB}GB (retention_days=${PRUNE_RETENTION_DAYS})."
    bun packages/ingest/src/cli.ts \
      --system "$SYSTEM_ID" \
      --prune \
      --retention-days "$PRUNE_RETENTION_DAYS" \
      --max-archive-gb "$PRUNE_LOW_WATER_GB" \
      --apply
    local after_gb
    after_gb="$(current_archive_gb "$GBFS_DATA_ROOT")"
    log "Prune complete. Archive size now ${after_gb}GB."
  else
    log "Archive size ${current_gb}GB within threshold (<= ${PRUNE_HIGH_WATER_GB}GB)."
  fi
}

prune_loop() {
  while true; do
    sleep "$PRUNE_INTERVAL_SECONDS"
    run_prune_cycle_if_needed
  done
}

log "Starting ingest poller for system_id=${SYSTEM_ID}"
log "Auto-prune enabled: high_water=${PRUNE_HIGH_WATER_GB}GB low_water=${PRUNE_LOW_WATER_GB}GB interval=${PRUNE_INTERVAL_SECONDS}s retention_days=${PRUNE_RETENTION_DAYS}"

bun packages/ingest/src/cli.ts \
  --system "$SYSTEM_ID" \
  --poll \
  --load-db \
  --refresh-serving \
  --severity-version "$SEVERITY_VERSION" \
  --pressure-proxy-method "$PRESSURE_PROXY_METHOD" &
poll_pid="$!"

# Early check at startup so oversized archives are corrected quickly.
run_prune_cycle_if_needed
prune_loop &
prune_pid="$!"

wait "$poll_pid"
