from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TieBreakerScore:
    moves: int
    travel_minutes: int
    quantity: int


def compare_scores(left: TieBreakerScore, right: TieBreakerScore) -> bool:
    return (left.moves, left.travel_minutes, left.quantity) < (
        right.moves,
        right.travel_minutes,
        right.quantity,
    )
