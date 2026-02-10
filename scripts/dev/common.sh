#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[dev] %s\n' "$*"
}

warn() {
  printf '[dev][warn] %s\n' "$*" >&2
}

die() {
  printf '[dev][error] %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || die "Missing required command: $cmd"
}

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || die "Not inside a git repository"
}

load_env_file_if_present() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

load_default_envs() {
  local root
  root="$(repo_root)"
  load_env_file_if_present "$root/.env.local"
  load_env_file_if_present "$root/.env.example"
  load_env_file_if_present "$root/packages/api/.env.local"
  load_env_file_if_present "$root/apps/web/.env.local"
}

