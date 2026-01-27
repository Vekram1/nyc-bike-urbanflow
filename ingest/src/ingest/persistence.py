from __future__ import annotations

from collections.abc import Sequence

from ..db.engine import execute_sql
from ..db.models import SnapshotHeader, SnapshotStationStatus


def write_snapshot(header: SnapshotHeader) -> None:
    execute_sql(
        "insert into snapshots (snapshot_id, ts, feed_ts, ingest_meta, is_valid) "
        "values ($1, $2, $3, $4, $5) on conflict (snapshot_id) do nothing",
        [
            header.snapshot_id,
            header.ts,
            header.feed_ts,
            header.ingest_meta,
            header.is_valid,
        ],
    )


def write_station_status_rows(rows: Sequence[SnapshotStationStatus]) -> None:
    for row in rows:
        execute_sql(
            "insert into snapshot_station_status (snapshot_id, station_id, bikes_available, "
            "docks_available, is_installed, is_renting, is_returning, num_bikes_disabled, "
            "num_docks_disabled) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
                row.snapshot_id,
                row.station_id,
                row.bikes_available,
                row.docks_available,
                row.is_installed,
                row.is_renting,
                row.is_returning,
                row.num_bikes_disabled,
                row.num_docks_disabled,
            ],
        )
