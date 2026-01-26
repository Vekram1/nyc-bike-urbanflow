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
