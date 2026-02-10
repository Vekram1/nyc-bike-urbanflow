#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

ROOT="$(repo_root)"
cd "$ROOT"
load_default_envs

require_cmd bun
require_cmd curl
require_cmd psql

SYSTEM_ID="${SYSTEM_ID:-citibike-nyc}"
DATABASE_URL="${DATABASE_URL:-postgres://urbanflow:urbanflow@127.0.0.1:5432/urbanflow}"
API_ORIGIN="${URBANFLOW_API_ORIGIN:-http://127.0.0.1:3000}"
WEB_ORIGIN="${WEB_ORIGIN:-http://127.0.0.1:3001}"

WITH_WEB=1
USE_LIVE_FETCH=0
REQUIRE_INGEST=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-web)
      WITH_WEB=0
      shift
      ;;
    --live-fetch)
      USE_LIVE_FETCH=1
      shift
      ;;
    --require-ingest)
      REQUIRE_INGEST=1
      shift
      ;;
    *)
      die "Unknown arg: $1"
      ;;
  esac
done

API_PID=""
WEB_PID=""
API_LOG=""
WEB_LOG=""

cleanup() {
  if [[ -n "$WEB_PID" ]] && kill -0 "$WEB_PID" >/dev/null 2>&1; then
    kill "$WEB_PID" >/dev/null 2>&1 || true
    wait "$WEB_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" >/dev/null 2>&1; then
    kill "$API_PID" >/dev/null 2>&1 || true
    wait "$API_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_http() {
  local url="$1"
  local max_tries="${2:-60}"
  local sleep_s="${3:-1}"
  local i=0
  while [[ "$i" -lt "$max_tries" ]]; do
    if curl -s -o /dev/null "$url"; then
      return 0
    fi
    sleep "$sleep_s"
    i=$((i + 1))
  done
  return 1
}

assert_http_status() {
  local expected="$1"
  local url="$2"
  local got
  got="$(curl -s -o /tmp/uf-smoke-body.json -w "%{http_code}" "$url")"
  if [[ "$got" != "$expected" ]]; then
    warn "Response body for $url:"
    cat /tmp/uf-smoke-body.json || true
    die "Expected HTTP $expected from $url, got $got"
  fi
}

log "Checking DB connectivity"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "select 1;" >/dev/null

log "Starting API for smoke"
API_LOG="/tmp/urbanflow-smoke-api.$$.log"
scripts/dev/start-api.sh >"$API_LOG" 2>&1 &
API_PID="$!"

wait_http "${API_ORIGIN}/api/time?system_id=${SYSTEM_ID}" 40 1 || {
  tail -n 120 "$API_LOG" || true
  die "API did not become reachable at ${API_ORIGIN}"
}

INGEST_OK=1
if [[ "$USE_LIVE_FETCH" -eq 1 ]]; then
  log "Running one-shot live ingest + DB load + serving refresh"
  if ! bun packages/ingest/src/cli.ts --system "$SYSTEM_ID" --load-db --refresh-serving; then
    INGEST_OK=0
  fi
else
  log "Loading fixture manifests into DB + serving refresh"
  if ! bun packages/ingest/src/cli.ts \
    --system "$SYSTEM_ID" \
    --load \
    --manifest fixtures/gbfs/manifests/station_information.manifest.json \
    --manifest fixtures/gbfs/manifests/station_status.manifest.json \
    --refresh-serving; then
    warn "Fixture ingest failed; falling back to one-shot live ingest."
    if ! bun packages/ingest/src/cli.ts --system "$SYSTEM_ID" --load-db --refresh-serving; then
      INGEST_OK=0
    fi
  fi
fi

if [[ "$INGEST_OK" -eq 0 ]]; then
  if [[ "$REQUIRE_INGEST" -eq 1 ]]; then
    die "Ingest+refresh failed in strict mode (--require-ingest)."
  fi
  warn "Ingest+refresh failed; continuing smoke checks (non-strict mode)."
fi

log "Verifying API health endpoints"
assert_http_status "200" "${API_ORIGIN}/api/time?system_id=${SYSTEM_ID}"
assert_http_status "200" "${API_ORIGIN}/api/policy/config?v=1"

if [[ "$WITH_WEB" -eq 1 ]]; then
  if [[ -z "${NEXT_PUBLIC_MAPBOX_TOKEN:-}" ]]; then
    die "NEXT_PUBLIC_MAPBOX_TOKEN is required for web smoke. Set env or pass --skip-web."
  fi

  log "Starting web for proxy route checks"
  WEB_LOG="/tmp/urbanflow-smoke-web.$$.log"
  scripts/dev/start-web.sh >"$WEB_LOG" 2>&1 &
  WEB_PID="$!"

  wait_http "${WEB_ORIGIN}/" 120 1 || {
    tail -n 120 "$WEB_LOG" || true
    die "Web did not become reachable at ${WEB_ORIGIN}"
  }

  log "Verifying web proxy routes"
  assert_http_status "200" "${WEB_ORIGIN}/api/time?system_id=${SYSTEM_ID}"
  assert_http_status "200" "${WEB_ORIGIN}/api/policy/config?v=1"
fi

log "Smoke checks passed"
