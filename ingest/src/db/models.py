from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class SnapshotHeader:
    snapshot_id: str
    ts: datetime
    feed_ts: datetime | None
    ingest_meta: dict[str, Any]
    is_valid: bool


@dataclass(frozen=True)
class SnapshotStationStatus:
    snapshot_id: str
    station_id: str
    bikes_available: int | None
    docks_available: int | None
    is_installed: bool | None
    is_renting: bool | None
    is_returning: bool | None
    num_bikes_disabled: int | None
    num_docks_disabled: int | None
