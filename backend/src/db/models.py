from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class StationRecord:
    station_id: str
    name: str | None
    lat: float | None
    lon: float | None
    capacity: int | None


@dataclass(frozen=True)
class BinRecord:
    station_id: str
    ts: datetime
    bikes_available: int | None
    docks_available: int | None
