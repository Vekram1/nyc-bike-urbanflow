#!/usr/bin/env bash
set -euo pipefail

API_ORIGIN="${API_ORIGIN:-http://127.0.0.1:3000}"
SYSTEM_ID="${SYSTEM_ID:-citibike-nyc}"
POLICY_VERSION="${POLICY_VERSION:-rebal.greedy.v1}"
TOP_N="${TOP_N:-200}"
BUCKET_SIZE="${BUCKET_SIZE:-300}"

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || { echo "Missing command: $1"; exit 1; }
}

require_cmd curl
require_cmd jq
require_cmd python3

echo "[1/4] Fetching serving token (sv)..."
TIME_JSON="$(curl -fsS "${API_ORIGIN}/api/time?v=1&system_id=${SYSTEM_ID}
&tile_schema=tile.v1&severity_version=sev.v1")"
SV="$(echo "$TIME_JSON" | jq -r '.recommended_live_sv // empty')"
if [[ -z "$SV" ]]; then
    echo "Failed to get recommended_live_sv"
    echo "$TIME_JSON"
    exit 1
fi
echo "SV: ${SV:0:18}..."

echo "[2/4] Fetching timeline live edge..."
TIMELINE_JSON="$(curl -fsS "${API_ORIGIN}/api/timeline?v=1&sv=${SV}
&system_id=${SYSTEM_ID}")"
LIVE_EDGE_TS="$(echo "$TIMELINE_JSON" | jq -r '.live_edge_ts // empty')"
if [[ -z "$LIVE_EDGE_TS" ]]; then
    echo "Failed to get live_edge_ts"
    echo "$TIMELINE_JSON"
    exit 1
fi

LIVE_EDGE_EPOCH="$(python3 - <<'PY' "$LIVE_EDGE_TS"
  import datetime,sys
  s=sys.argv[1].replace("Z","+00:00")
  print(int(datetime.datetime.fromisoformat(s).timestamp()))
  PY
  )"
  T_BUCKET="$(( (LIVE_EDGE_EPOCH / BUCKET_SIZE) * BUCKET_SIZE ))"
  echo "Live edge: $LIVE_EDGE_TS"
  echo "T_bucket:  $T_BUCKET"

  echo "[3/4] Triggering policy run..."
  RUN_URL="${API_ORIGIN}/api/policy/run?v=1&sv=${SV}
  &policy_version=${POLICY_VERSION}&T_bucket=${T_BUCKET}"
  RUN_JSON="$(curl -fsS "$RUN_URL")"
  echo "$RUN_JSON" | jq

  echo "[4/4] Polling moves..."
  for i in {1..20}; do
    MOVES_URL="${API_ORIGIN}/api/policy/moves?v=1&sv=${SV}
  &policy_version=${POLICY_VERSION}&T_bucket=${T_BUCKET}&top_n=${TOP_N}"
    MOVES_JSON="$(curl -fsS "$MOVES_URL")"
    STATUS="$(echo "$MOVES_JSON" | jq -r '.status // empty')"
    if [[ "$STATUS" == "ready" ]]; then
      echo "Moves ready on attempt $i"
      echo "$MOVES_JSON" | jq '.run, {move_count: (.moves|length), sample_moves:
  (.moves[:10])}'
      exit 0
    fi
    RETRY_MS="$(echo "$MOVES_JSON" | jq -r '.retry_after_ms // 1500')"
    echo "Pending (attempt $i). Sleeping ${RETRY_MS}ms..."
    python3 - <<'PY' "$RETRY_MS"
  import sys,time
  time.sleep(max(0.1,int(sys.argv[1])/1000))
  PY
done

  echo "Timed out waiting for moves."
  echo "$MOVES_JSON" | jq
  exit 1

