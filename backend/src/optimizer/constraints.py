from __future__ import annotations


def is_within_capacity(quantity: int, capacity: int) -> bool:
    return 0 <= quantity <= capacity


def has_feasible_plan(candidates: int) -> bool:
    return candidates > 0
