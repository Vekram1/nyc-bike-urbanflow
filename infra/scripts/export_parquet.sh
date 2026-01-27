#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR=${1:-"data/parquet"}

mkdir -p "$OUTPUT_DIR"

echo "Parquet export placeholder -> $OUTPUT_DIR"
