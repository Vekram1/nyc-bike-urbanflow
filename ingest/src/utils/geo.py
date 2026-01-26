from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_geojson(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def feature_geometry(geojson: dict[str, Any]) -> dict[str, Any] | None:
    features = geojson.get("features", [])
    if not features:
        return None
    return features[0].get("geometry")
