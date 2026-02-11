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

if command -v shasum >/dev/null 2>&1; then
  db_hash="$(printf '%s' "$DATABASE_URL" | shasum -a 256 | awk '{print $1}' | cut -c1-12)"
  log "DATABASE_URL hash: ${db_hash}"
fi

log "Starting policy worker"
exec bun packages/api/src/policy/worker.ts
