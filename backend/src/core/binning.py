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


def compute_deltas(
    rows: Iterable[BinRow],
) -> list[tuple[BinRow, int | None, int | None]]:
    grouped = group_by_station(rows)
    output: list[tuple[BinRow, int | None, int | None]] = []
    for station_rows in grouped.values():
        sorted_rows = sorted(station_rows, key=lambda row: row.ts)
        previous: BinRow | None = None
        for row in sorted_rows:
            delta_bikes = None
            delta_docks = None
            if previous is not None:
                if (
                    row.bikes_available is not None
                    and previous.bikes_available is not None
                ):
                    delta_bikes = row.bikes_available - previous.bikes_available
                if (
                    row.docks_available is not None
                    and previous.docks_available is not None
                ):
                    delta_docks = row.docks_available - previous.docks_available
            output.append((row, delta_bikes, delta_docks))
            previous = row
    return output
