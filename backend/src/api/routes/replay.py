from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter

from ...db.queries import fetch_replay_bins


router = APIRouter()


@router.get("/replay")
def get_replay() -> list[dict[str, Any]]:
    def run_query(_: str, __: Sequence[object]) -> Iterable[Sequence[object]]:
        return []

    now = datetime.now(tz=timezone.utc)
    records = fetch_replay_bins(run_query, now, now)
    return [
        {
            "station_id": record.station_id,
            "ts": record.ts,
            "bikes_available": record.bikes_available,
            "docks_available": record.docks_available,
        }
        for record in records
    ]
