from __future__ import annotations

import json
from typing import Any
from urllib.request import urlopen

from .config import station_information_url, station_status_url


def fetch_station_information() -> dict[str, Any]:
    return _fetch_json(station_information_url())


def fetch_station_status() -> dict[str, Any]:
    return _fetch_json(station_status_url())


def _fetch_json(url: str) -> dict[str, Any]:
    with urlopen(url, timeout=30) as response:
        payload = response.read()
    return json.loads(payload)
