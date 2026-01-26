from __future__ import annotations

from backend.simulator.scoring import failure_minutes


def test_failure_minutes_zero_when_unreliable() -> None:
    assert failure_minutes(is_empty=True, is_full=False, is_reliable=False) == 0
