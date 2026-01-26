from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DriftResult:
    drift: float


def net_drift(deltas: list[int]) -> DriftResult:
    if not deltas:
        return DriftResult(drift=0.0)
    return DriftResult(drift=sum(deltas) / len(deltas))


def windowed_drift(deltas: list[int], window: int = 6) -> DriftResult:
    if window <= 0:
        return DriftResult(drift=0.0)
    windowed = deltas[-window:]
    return net_drift(windowed)
