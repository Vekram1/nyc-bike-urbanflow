from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from datetime import datetime
from typing import cast

from .models import BinRecord, StationRecord

QueryRunner = Callable[[str, Sequence[object]], Iterable[Sequence[object]]]

STATE_QUERY = (
    "select distinct on (station_id) station_id, ts, bikes_available, docks_available "
    "from bins_5m order by station_id, ts desc"
)


def empty_stations() -> list[StationRecord]:
    return []


def fetch_latest_state(run_query: QueryRunner) -> list[BinRecord]:
    rows = run_query(STATE_QUERY, [])
    return [
        BinRecord(
            station_id=cast(str, row[0]),
            ts=cast(datetime, row[1]),
            bikes_available=cast(int | None, row[2]),
            docks_available=cast(int | None, row[3]),
        )
        for row in rows
    ]
