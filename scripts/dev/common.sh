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
    while IFS= read -r line || [[ -n "$line" ]]; do
      # skip empty lines and comments
      [[ -z "$line" ]] && continue
      [[ "$line" =~ ^[[:space:]]*# ]] && continue

      # dotenv-style KEY=VALUE parser (no shell eval)
      local key="${line%%=*}"
      local value="${line#*=}"
      key="${key#"${key%%[![:space:]]*}"}"
      key="${key%"${key##*[![:space:]]}"}"

      [[ -z "$key" ]] && continue
      export "$key=$value"
    done <"$env_file"
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
