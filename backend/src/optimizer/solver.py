from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PlanResult:
    status: str
    reason: str | None = None
