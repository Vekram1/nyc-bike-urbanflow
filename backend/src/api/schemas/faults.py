from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class FaultWindow(BaseModel):
    station_id: str
    start: datetime
    end: datetime
    fault_type: str


class FaultSummary(BaseModel):
    operational_faults: list[FaultWindow]
    unreliable_faults: list[FaultWindow]
