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

log "Starting policy worker"
exec bun packages/api/src/policy/worker.ts
