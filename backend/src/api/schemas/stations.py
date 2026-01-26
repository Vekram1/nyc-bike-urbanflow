from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class Station(BaseModel):
    station_id: str
    name: str | None = None
    lat: float | None = None
    lon: float | None = None
    capacity: int | None = None
    metadata: dict[str, Any] | None = None
