from __future__ import annotations

from datetime import datetime, timezone

from backend.simulator.engine import StepState, advance_step


def test_advance_step_clamps_inventory() -> None:
    state = StepState(
        station_id="station-1",
        ts=datetime(2024, 1, 1, tzinfo=timezone.utc),
        bikes_available=2,
        capacity=5,
    )

    next_state = advance_step(state, delta=-5)

    assert next_state.bikes_available == 0
