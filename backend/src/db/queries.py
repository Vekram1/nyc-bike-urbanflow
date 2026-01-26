from __future__ import annotations

from .models import BinRecord, StationRecord


def empty_stations() -> list[StationRecord]:
    return []


def latest_bins() -> list[BinRecord]:
    return []
