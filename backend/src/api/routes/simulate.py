from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from ...services.simulate_service import run_simulation


router = APIRouter()


@router.post("/simulate")
def simulate() -> dict[str, Any]:
    result = run_simulation()
    return {
        "steps": [
            {
                "ts": step.ts,
                "station_id": step.station_id,
                "bikes_available": step.bikes_available,
                "docks_available": step.docks_available,
            }
            for step in result.steps
        ]
    }
