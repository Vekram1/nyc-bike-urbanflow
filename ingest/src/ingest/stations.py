from __future__ import annotations

from collections.abc import Sequence

from ..db.engine import execute_sql


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
        name = row.get("name")
        lat = row.get("lat")
        lon = row.get("lon")
        capacity = row.get("capacity")
        upsert_station(
            station_id=str(row.get("station_id")),
            name=name if isinstance(name, str) else None,
            lat=float(lat) if isinstance(lat, (int, float)) else None,
            lon=float(lon) if isinstance(lon, (int, float)) else None,
            capacity=capacity if isinstance(capacity, int) else None,
        )
