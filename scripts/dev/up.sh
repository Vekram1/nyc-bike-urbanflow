#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

ROOT="$(repo_root)"
cd "$ROOT"

require_cmd bash

if command -v tmux >/dev/null 2>&1; then
  SESSION="${1:-urbanflow-dev}"
  log "Starting tmux session: $SESSION"
  tmux has-session -t "$SESSION" 2>/dev/null && {
    warn "Session '$SESSION' already exists. Attaching."
    exec tmux attach -t "$SESSION"
  }

  tmux new-session -d -s "$SESSION" -n setup "cd '$ROOT' && scripts/dev/setup.sh; echo; echo 'setup done'; exec bash"
  tmux split-window -h -t "$SESSION:0" "cd '$ROOT' && scripts/dev/start-api.sh"
  tmux split-window -v -t "$SESSION:0.1" "cd '$ROOT' && scripts/dev/start-web.sh"
  tmux split-window -v -t "$SESSION:0.0" "cd '$ROOT' && scripts/dev/start-ingest.sh"
  tmux split-window -v -t "$SESSION:0.2" "cd '$ROOT' && scripts/dev/start-policy-worker.sh"
  tmux select-layout -t "$SESSION:0" tiled
  exec tmux attach -t "$SESSION"
fi

warn "tmux not found. Run these in separate terminals:"
echo "  scripts/dev/setup.sh"
echo "  scripts/dev/start-api.sh"
echo "  scripts/dev/start-web.sh"
echo "  scripts/dev/start-ingest.sh"
echo "  scripts/dev/start-policy-worker.sh"
