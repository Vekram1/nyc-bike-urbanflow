from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Callable

from .gbfs_client import fetch_station_information, fetch_station_status
from .parser import station_information_data, station_status_data
from .persistence import write_snapshot, write_station_status_rows
from .stations import upsert_stations
from .validators import feed_timestamp, is_feed_advanced
from ..db.models import SnapshotHeader, SnapshotStationStatus

PollHandler = Callable[
    [dict[str, Any], dict[str, Any], datetime | None, datetime | None], None
]


def poll_once(
    previous_info_ts: datetime | None,
    previous_status_ts: datetime | None,
) -> tuple[dict[str, Any], dict[str, Any], datetime | None, datetime | None]:
    station_information = fetch_station_information()
    station_status = fetch_station_status()

    info_ts = feed_timestamp(station_information)
    status_ts = feed_timestamp(station_status)

    if not is_feed_advanced(previous_info_ts, info_ts):
        raise ValueError("station_information feed timestamp did not advance")
    if not is_feed_advanced(previous_status_ts, status_ts):
        raise ValueError("station_status feed timestamp did not advance")

    return station_information, station_status, info_ts, status_ts


def run_polling(handler: PollHandler, interval_seconds: int = 60) -> None:
    previous_info_ts: datetime | None = None
    previous_status_ts: datetime | None = None

    while True:
        started_at = time.monotonic()
        try:
            info, status, info_ts, status_ts = poll_once(
                previous_info_ts,
                previous_status_ts,
            )
        except ValueError:
            info_ts = None
            status_ts = None
        else:
            previous_info_ts = info_ts
            previous_status_ts = status_ts
            handler(info, status, info_ts, status_ts)

        elapsed = time.monotonic() - started_at
        sleep_for = max(0.0, interval_seconds - elapsed)
        time.sleep(sleep_for)


def ingest_handler(
    info: dict[str, Any], status: dict[str, Any], *_: datetime | None
) -> None:
    station_rows = station_information_data(info)
    status_rows = station_status_data(status)
    upsert_stations(station_rows)
    snapshot_ts = datetime.now(tz=timezone.utc)
    snapshot_id = str(int(snapshot_ts.timestamp()))
    header = SnapshotHeader(
        snapshot_id=snapshot_id,
        ts=snapshot_ts,
        feed_ts=feed_timestamp(status),
        ingest_meta={},
        is_valid=True,
    )
    status_records = [
        SnapshotStationStatus(
            snapshot_id=snapshot_id,
            station_id=str(row.get("station_id")),
            bikes_available=row.get("num_bikes_available"),
            docks_available=row.get("num_docks_available"),
            is_installed=_truthy(row.get("is_installed")),
            is_renting=_truthy(row.get("is_renting")),
            is_returning=_truthy(row.get("is_returning")),
            num_bikes_disabled=row.get("num_bikes_disabled"),
            num_docks_disabled=row.get("num_docks_disabled"),
        )
        for row in status_rows
    ]
    write_snapshot(header)
    write_station_status_rows(status_records)


def _truthy(value: object) -> bool | None:
    if value is None:
        return None
    return bool(value)
