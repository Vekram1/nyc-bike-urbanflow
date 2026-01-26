from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CapacityResult:
    capacity: int | None
    source: str
    is_reliable: bool


def effective_capacity(
    bikes_available: int | None,
    docks_available: int | None,
    station_capacity: int | None,
) -> CapacityResult:
    if bikes_available is not None and docks_available is not None:
        total = bikes_available + docks_available
        if total > 0:
            return CapacityResult(
                capacity=total,
                source="status_sum",
                is_reliable=True,
            )
    if station_capacity and station_capacity > 0:
        return CapacityResult(
            capacity=station_capacity,
            source="station_info",
            is_reliable=False,
        )
    return CapacityResult(capacity=None, source="missing", is_reliable=False)
