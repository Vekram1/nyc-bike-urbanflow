#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

ROOT="$(repo_root)"
cd "$ROOT"
load_default_envs

SYSTEM_ID="${SYSTEM_ID:-citibike-nyc}"
DATABASE_URL="${DATABASE_URL:-postgres://urbanflow:urbanflow@127.0.0.1:5432/urbanflow}"
SV_KEY_MATERIAL_JSON="${SV_KEY_MATERIAL_JSON:-{\"k1\":\"dev-secret\"}}"

require_cmd bun
require_cmd docker
require_cmd psql

log "Installing workspace dependencies with bun"
bun install

[[ -f "$ROOT/docker-compose.yml" ]] || die "docker-compose.yml is required for setup.sh (compose-only mode)"
docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is required (docker compose)"
log "Starting PostGIS via docker compose"
if ! docker compose up -d postgis; then
  warn "docker compose failed on default platform; retrying with linux/amd64 compatibility mode"
  DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose up -d postgis || die "Failed to start PostGIS container"
fi

log "Waiting for database readiness"
for _ in {1..30}; do
  if psql "$DATABASE_URL" -c "select 1" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
psql "$DATABASE_URL" -c "select 1" >/dev/null 2>&1 || die "Database is not reachable at DATABASE_URL"

log "Ensuring PostGIS extension"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS postgis;" >/dev/null

if [[ "$(psql "$DATABASE_URL" -tA -c "select to_regclass('public.systems') is not null;")" == "t" ]]; then
  log "Core schema already present (systems table exists); skipping migration replay"
else
  log "Applying SQL migrations"
  for f in sql/migrations/*.sql; do
    log "Applying $f"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" >/dev/null
  done
fi

log "Seeding systems row for $SYSTEM_ID"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v system_id="$SYSTEM_ID" <<'SQL' >/dev/null
INSERT INTO systems (
  system_id,
  gbfs_entrypoint_url,
  default_map_bounds,
  default_center,
  timezone,
  provider_name,
  provider_region
)
VALUES (
  :'system_id',
  'https://gbfs.citibikenyc.com/gbfs/gbfs.json',
  ARRAY[-74.25909, 40.477399, -73.700272, 40.917577]::double precision[],
  ARRAY[-73.98513, 40.758896]::double precision[],
  'America/New_York',
  'Citi Bike',
  'NYC'
)
ON CONFLICT (system_id) DO UPDATE SET
  gbfs_entrypoint_url = EXCLUDED.gbfs_entrypoint_url,
  default_map_bounds = EXCLUDED.default_map_bounds,
  default_center = EXCLUDED.default_center,
  timezone = EXCLUDED.timezone,
  provider_name = EXCLUDED.provider_name,
  provider_region = EXCLUDED.provider_region,
  updated_at = NOW();
SQL

ACTIVE_KID="$(SV_KEY_MATERIAL_JSON="$SV_KEY_MATERIAL_JSON" bun -e '
const raw = process.env.SV_KEY_MATERIAL_JSON ?? "";
let kid = "k1";
try {
  const parsed = JSON.parse(raw);
  const keys = Object.keys(parsed || {});
  if (keys.length > 0) kid = keys[0];
} catch {}
process.stdout.write(kid);
')"
log "Ensuring serving key row for kid=${ACTIVE_KID}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v system_id="$SYSTEM_ID" -v kid="$ACTIVE_KID" <<'SQL' >/dev/null
INSERT INTO serving_keys (
  kid,
  system_id,
  algo,
  status,
  valid_from
)
VALUES (
  :'kid',
  :'system_id',
  'HS256',
  'active',
  NOW() - INTERVAL '1 minute'
)
ON CONFLICT (kid) DO UPDATE SET
  system_id = EXCLUDED.system_id,
  algo = EXCLUDED.algo,
  status = EXCLUDED.status,
  valid_from = LEAST(serving_keys.valid_from, EXCLUDED.valid_from),
  valid_to = NULL,
  rotated_at = NULL;
SQL

log "Setup complete"
log "Next steps:"
log "  scripts/dev/start-api.sh"
log "  scripts/dev/start-web.sh"
log "  scripts/dev/start-ingest.sh"
log "  scripts/dev/up.sh  # tmux launcher"
