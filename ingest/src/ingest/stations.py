from __future__ import annotations

from collections.abc import Sequence

from ingest.db.engine import execute_sql


def upsert_station(
    station_id: str,
    name: str | None,
    lat: float | None,
    lon: float | None,
    capacity: int | None,
) -> None:
    execute_sql(
        "insert into stations (station_id, name, lat, lon, capacity) "
        "values ($1, $2, $3, $4, $5) "
        "on conflict (station_id) do update set name = excluded.name, "
        "lat = excluded.lat, lon = excluded.lon, capacity = excluded.capacity",
        [station_id, name, lat, lon, capacity],
    )


def upsert_stations(rows: Sequence[dict[str, object]]) -> None:
    for row in rows:
        upsert_station(
            station_id=str(row.get("station_id")),
            name=row.get("name") if isinstance(row.get("name"), str) else None,
            lat=row.get("lat") if isinstance(row.get("lat"), (int, float)) else None,
            lon=row.get("lon") if isinstance(row.get("lon"), (int, float)) else None,
            capacity=row.get("capacity")
            if isinstance(row.get("capacity"), int)
            else None,
        )
