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

require_cmd bun
require_cmd docker
require_cmd psql

log "Installing workspace dependencies with bun"
bun install

[[ -f "$ROOT/docker-compose.yml" ]] || die "docker-compose.yml is required for setup.sh (compose-only mode)"
docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is required (docker compose)"
log "Starting PostGIS via docker compose"
docker compose up -d postgis

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

log "Applying SQL migrations"
for f in sql/migrations/*.sql; do
  log "Applying $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done

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

log "Setup complete"
log "Next steps:"
log "  scripts/dev/start-api.sh"
log "  scripts/dev/start-web.sh"
log "  scripts/dev/start-ingest.sh"
log "  scripts/dev/up.sh  # tmux launcher"
