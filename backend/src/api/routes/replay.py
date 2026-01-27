from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter

from ...db.engine import run_query
from ...db.queries import fetch_replay_bins


router = APIRouter()


@router.get("/replay")
def get_replay() -> list[dict[str, Any]]:
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
