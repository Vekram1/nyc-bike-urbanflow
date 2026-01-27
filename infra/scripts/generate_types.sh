#!/usr/bin/env bash
set -euo pipefail

OPENAPI_PATH="shared/openapi/openapi.json"
OUTPUT_PATH="shared/types/api.ts"

if [ ! -f "$OPENAPI_PATH" ]; then
  echo "OpenAPI spec not found at $OPENAPI_PATH" >&2
  exit 1
fi

echo "Generating types from $OPENAPI_PATH"

if command -v openapi-typescript >/dev/null 2>&1; then
  openapi-typescript "$OPENAPI_PATH" --output "$OUTPUT_PATH"
else
  echo "openapi-typescript not installed; skipping generation" >&2
  exit 1
fi
