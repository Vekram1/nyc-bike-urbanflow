from __future__ import annotations

from dataclasses import dataclass

from .tie_breakers import TieBreakerScore, compare_scores


@dataclass(frozen=True)
class PlanResult:
    status: str
    reason: str | None = None


def pick_better(left: TieBreakerScore, right: TieBreakerScore) -> TieBreakerScore:
    if compare_scores(left, right):
        return left
    return right
