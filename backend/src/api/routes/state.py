from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from ...db.engine import run_query
from ...db.queries import fetch_latest_state


router = APIRouter()


@router.get("/state")
def get_state() -> list[dict[str, Any]]:
    records = fetch_latest_state(run_query)
    return [
        {
            "station_id": record.station_id,
            "ts": record.ts,
            "bikes_available": record.bikes_available,
            "docks_available": record.docks_available,
        }
        for record in records
    ]
