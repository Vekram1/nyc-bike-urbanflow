from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CapacityResult:
    capacity: int | None
    source: str


def effective_capacity(
    bikes_available: int | None,
    docks_available: int | None,
    station_capacity: int | None,
) -> CapacityResult:
    if bikes_available is not None and docks_available is not None:
        total = bikes_available + docks_available
        if total > 0:
            return CapacityResult(capacity=total, source="status_sum")
    if station_capacity and station_capacity > 0:
        return CapacityResult(capacity=station_capacity, source="station_info")
    return CapacityResult(capacity=None, source="missing")
