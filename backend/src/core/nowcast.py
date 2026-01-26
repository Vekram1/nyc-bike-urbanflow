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


@dataclass(frozen=True)
class RiskResult:
    minutes_to_threshold: float | None
    risk: float


def projected_minutes_to_threshold(current: int, drift_per_bin: float) -> float | None:
    if drift_per_bin == 0:
        return None
    return -current / drift_per_bin


def risk_from_minutes(minutes: float | None) -> RiskResult:
    if minutes is None:
        return RiskResult(minutes_to_threshold=None, risk=0.0)
    if minutes <= 15:
        return RiskResult(minutes_to_threshold=minutes, risk=1.0)
    if minutes >= 60:
        return RiskResult(minutes_to_threshold=minutes, risk=0.0)
    taper = (60 - minutes) / 45
    return RiskResult(minutes_to_threshold=minutes, risk=max(0.0, min(1.0, taper)))
