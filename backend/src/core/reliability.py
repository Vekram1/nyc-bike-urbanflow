from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ReliabilityResult:
    is_reliable: bool
    reason: str | None = None


def mark_reliable(reason: str | None = None) -> ReliabilityResult:
    return ReliabilityResult(is_reliable=True, reason=reason)


def mark_unreliable(reason: str) -> ReliabilityResult:
    return ReliabilityResult(is_reliable=False, reason=reason)


def reason_offline() -> ReliabilityResult:
    return mark_unreliable("offline")


def reason_disabled() -> ReliabilityResult:
    return mark_unreliable("disabled")


def reason_capacity_missing() -> ReliabilityResult:
    return mark_unreliable("capacity_missing")


def reason_status_invalid() -> ReliabilityResult:
    return mark_unreliable("status_invalid")


def from_capacity_reason(reason: str | None) -> ReliabilityResult:
    if reason is None:
        return mark_reliable()
    if reason == "capacity_missing":
        return reason_capacity_missing()
    if reason == "status_invalid":
        return reason_status_invalid()
    return mark_unreliable(reason)
