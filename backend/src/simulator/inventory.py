from __future__ import annotations


def clamp_inventory(value: int, capacity: int) -> int:
    if value < 0:
        return 0
    if value > capacity:
        return capacity
    return value
