from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def write_snapshot(directory: Path, prefix: str, payload: dict[str, Any]) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{prefix}.json"
    path.write_text(json.dumps(payload))
    return path


def read_snapshot(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())
