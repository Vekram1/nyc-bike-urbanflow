from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable


def load_geojson(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def feature_geometry(geojson: dict[str, Any]) -> dict[str, Any] | None:
    features = geojson.get("features", [])
    if not features:
        return None
    return features[0].get("geometry")


def contains_point(
    polygon_geojson: dict[str, Any], longitude: float, latitude: float
) -> bool:
    geometry = feature_geometry(polygon_geojson)
    if geometry is None:
        return False
    if geometry.get("type") != "Polygon":
        return False
    rings = geometry.get("coordinates", [])
    if not rings:
        return False
    ring = rings[0]
    return _point_in_ring(ring, longitude, latitude)


def _point_in_ring(
    ring: Iterable[Iterable[float]], longitude: float, latitude: float
) -> bool:
    inside = False
    coords = list(ring)
    if len(coords) < 3:
        return False

    for index in range(len(coords) - 1):
        x1, y1 = coords[index]
        x2, y2 = coords[index + 1]
        intersects = (y1 > latitude) != (y2 > latitude)
        if not intersects:
            continue
        slope = (x2 - x1) * (latitude - y1) / (y2 - y1 + 1e-12) + x1
        if longitude < slope:
            inside = not inside
    return inside
