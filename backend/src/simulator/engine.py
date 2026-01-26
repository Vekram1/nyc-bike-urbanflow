from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .inventory import clamp_inventory


@dataclass(frozen=True)
class StepState:
    station_id: str
    ts: datetime
    bikes_available: int
    capacity: int


def advance_step(state: StepState, delta: int) -> StepState:
    next_value = clamp_inventory(state.bikes_available + delta, state.capacity)
    return StepState(
        station_id=state.station_id,
        ts=state.ts,
        bikes_available=next_value,
        capacity=state.capacity,
    )
