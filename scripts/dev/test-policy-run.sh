#!/usr/bin/env bash
set -euo pipefail

API_ORIGIN="${API_ORIGIN:-http://127.0.0.1:3000}"
SYSTEM_ID="${SYSTEM_ID:-citibike-nyc}"
POLICY_VERSION="${POLICY_VERSION:-rebal.greedy.v1}"
TOP_N="${TOP_N:-200}"
BUCKET_SIZE="${BUCKET_SIZE:-300}"
T_BUCKET_OVERRIDE="${T_BUCKET:-}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing command: $1" >&2
    exit 1
  }
}

require_cmd curl
require_cmd jq
require_cmd python3

echo "[1/4] Fetching serving token (sv)..."
# /api/time is strict: only system_id is accepted.
TIME_JSON="$(curl -sS "${API_ORIGIN}/api/time?system_id=${SYSTEM_ID}")"
if ! echo "$TIME_JSON" | jq -e . >/dev/null 2>&1; then
  echo "Invalid /api/time response:"
  echo "$TIME_JSON"
  exit 1
fi
if [[ "$(echo "$TIME_JSON" | jq -r '.error.code // empty')" != "" ]]; then
  echo "Error from /api/time:"
  echo "$TIME_JSON" | jq
  exit 1
fi
SV="$(echo "$TIME_JSON" | jq -r '.recommended_live_sv // empty')"
if [[ -z "$SV" ]]; then
  echo "Failed to get recommended_live_sv" >&2
  echo "$TIME_JSON"
  exit 1
fi
echo "SV: ${SV:0:18}..."

if [[ -n "$T_BUCKET_OVERRIDE" ]]; then
  if ! [[ "$T_BUCKET_OVERRIDE" =~ ^[0-9]+$ ]]; then
    echo "T_BUCKET must be an integer epoch seconds value" >&2
    exit 1
  fi
  T_BUCKET="$T_BUCKET_OVERRIDE"
  echo "[2/4] Using provided T_bucket: $T_BUCKET"
else
  echo "[2/4] Fetching timeline live edge..."
  # /api/timeline accepts only v and sv.
  TIMELINE_JSON="$(curl -sS "${API_ORIGIN}/api/timeline?v=1&sv=${SV}")"
  if ! echo "$TIMELINE_JSON" | jq -e . >/dev/null 2>&1; then
    echo "Invalid /api/timeline response:"
    echo "$TIMELINE_JSON"
    exit 1
  fi
  if [[ "$(echo "$TIMELINE_JSON" | jq -r '.error.code // empty')" != "" ]]; then
    echo "Error from /api/timeline:"
    echo "$TIMELINE_JSON" | jq
    exit 1
  fi
  LIVE_EDGE_TS="$(echo "$TIMELINE_JSON" | jq -r '.live_edge_ts // empty')"
  if [[ -z "$LIVE_EDGE_TS" ]]; then
    echo "Failed to get live_edge_ts" >&2
    echo "$TIMELINE_JSON"
    exit 1
  fi

  LIVE_EDGE_EPOCH="$(python3 - <<'PY' "$LIVE_EDGE_TS"
import datetime, sys
s = sys.argv[1].replace("Z", "+00:00")
print(int(datetime.datetime.fromisoformat(s).timestamp()))
PY
)"
  T_BUCKET="$(( (LIVE_EDGE_EPOCH / BUCKET_SIZE) * BUCKET_SIZE ))"
  echo "Live edge: $LIVE_EDGE_TS"
  echo "T_bucket:  $T_BUCKET"
fi

echo "[3/4] Triggering policy run..."
RUN_URL="${API_ORIGIN}/api/policy/run?v=1&sv=${SV}&policy_version=${POLICY_VERSION}&T_bucket=${T_BUCKET}"
RUN_JSON="$(curl -sS "$RUN_URL")"
if ! echo "$RUN_JSON" | jq -e . >/dev/null 2>&1; then
  echo "Invalid /api/policy/run response:"
  echo "$RUN_JSON"
  exit 1
fi
echo "$RUN_JSON" | jq
if [[ "$(echo "$RUN_JSON" | jq -r '.error.code // empty')" != "" ]]; then
  echo "Run request failed." >&2
  exit 1
fi

echo "[4/4] Polling moves..."
for i in {1..20}; do
  MOVES_URL="${API_ORIGIN}/api/policy/moves?v=1&sv=${SV}&policy_version=${POLICY_VERSION}&T_bucket=${T_BUCKET}&top_n=${TOP_N}"
  MOVES_JSON="$(curl -sS "$MOVES_URL")"
  if ! echo "$MOVES_JSON" | jq -e . >/dev/null 2>&1; then
    echo "Invalid /api/policy/moves response:"
    echo "$MOVES_JSON"
    exit 1
  fi
  ERROR_CODE="$(echo "$MOVES_JSON" | jq -r '.error.code // empty')"
  if [[ -n "$ERROR_CODE" ]]; then
    echo "Moves request failed with ${ERROR_CODE}:"
    echo "$MOVES_JSON" | jq
    exit 1
  fi
  STATUS="$(echo "$MOVES_JSON" | jq -r '.status // empty')"
  if [[ "$STATUS" == "ready" ]]; then
    echo "Moves ready on attempt $i"
    echo "$MOVES_JSON" | jq '.run, {move_count: (.moves | length), sample_moves: (.moves[:10])}'
    FINAL_RUN_JSON="$(curl -sS "$RUN_URL")"
    if echo "$FINAL_RUN_JSON" | jq -e '.status == "ready"' >/dev/null 2>&1; then
      echo "Final run summary:"
      echo "$FINAL_RUN_JSON" | jq '{status, run: (.run | {run_id, no_op, no_op_reason, move_count, input_quality, error_reason})}'
    fi
    exit 0
  fi
  RETRY_MS="$(echo "$MOVES_JSON" | jq -r '.retry_after_ms // 1500')"
  echo "Pending (attempt $i). Sleeping ${RETRY_MS}ms..."
  python3 - <<'PY' "$RETRY_MS"
import sys, time
time.sleep(max(0.1, int(sys.argv[1]) / 1000))
PY
done

echo "Timed out waiting for moves (run stayed pending)." >&2
echo "Likely cause: policy worker not consuming queue (worker down or DB unreachable)." >&2
echo "Check worker directly: scripts/dev/start-policy-worker.sh" >&2
echo "Then restart API+worker: scripts/dev/start-api.sh" >&2
echo "$MOVES_JSON" | jq
exit 1
