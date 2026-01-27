from __future__ import annotations

from collections.abc import Sequence

from .engine import run_query


def write_bin_rows(rows: Sequence[Sequence[object]]) -> None:
    for row in rows:
        run_query(
            "insert into bins_5m (station_id, ts, bikes_available, docks_available, delta_bikes, "
            "delta_docks, capacity_source, is_reliable, reliability_reason) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) "
            "on conflict (station_id, ts) do nothing",
            list(row),
        )
