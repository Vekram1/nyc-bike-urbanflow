from __future__ import annotations

from typing import Any


def station_information_data(payload: dict[str, Any]) -> list[dict[str, Any]]:
    data = payload.get("data", {})
    stations = data.get("stations", [])
    if not isinstance(stations, list):
        return []
    return stations


def station_status_data(payload: dict[str, Any]) -> list[dict[str, Any]]:
    data = payload.get("data", {})
    stations = data.get("stations", [])
    if not isinstance(stations, list):
        return []
    return stations
