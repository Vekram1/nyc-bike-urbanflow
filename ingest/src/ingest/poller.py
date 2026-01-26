from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Callable

from .gbfs_client import fetch_station_information, fetch_station_status
from .validators import feed_timestamp, is_feed_advanced

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
