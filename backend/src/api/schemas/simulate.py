from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class SimulationStep(BaseModel):
    ts: datetime
    station_id: str
    bikes_available: int | None = None
    docks_available: int | None = None


class SimulationResponse(BaseModel):
    steps: list[SimulationStep]
