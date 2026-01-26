from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Iterable


@dataclass(frozen=True)
class BinRow:
    station_id: str
    ts: datetime
    bikes_available: int | None
    docks_available: int | None


def group_by_station(rows: Iterable[BinRow]) -> dict[str, list[BinRow]]:
    grouped: dict[str, list[BinRow]] = {}
    for row in rows:
        grouped.setdefault(row.station_id, []).append(row)
    return grouped
