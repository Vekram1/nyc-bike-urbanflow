from __future__ import annotations

from math import cos, radians, sin, sqrt


def projected_distance_meters(
    lon1: float,
    lat1: float,
    lon2: float,
    lat2: float,
) -> float:
    x1, y1 = _project_lon_lat(lon1, lat1)
    x2, y2 = _project_lon_lat(lon2, lat2)
    return sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)


def _project_lon_lat(lon: float, lat: float) -> tuple[float, float]:
    lat0 = radians(40.72)
    meters_per_deg_lat = 111_132.92
    meters_per_deg_lon = 111_412.84 * cos(lat0) - 93.5 * cos(3 * lat0)
    x = lon * meters_per_deg_lon
    y = lat * meters_per_deg_lat
    return x, y
