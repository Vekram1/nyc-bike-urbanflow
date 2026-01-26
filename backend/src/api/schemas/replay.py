from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ReplayBin(BaseModel):
    station_id: str
    ts: datetime
    bikes_available: int | None = None
    docks_available: int | None = None
    delta_bikes: int | None = None
    delta_docks: int | None = None
    is_empty: bool | None = None
    is_full: bool | None = None
