from __future__ import annotations

from datetime import datetime

from ..api.schemas.simulate import SimulationResponse, SimulationStep
from ..simulator.engine import StepState, apply_interventions, replay_deltas


def run_simulation() -> SimulationResponse:
    state = StepState(
        station_id="station-1",
        ts=datetime.utcnow(),
        bikes_available=5,
        capacity=10,
    )
    states = apply_interventions([state], [0])
    output = replay_deltas(states, [0])
    steps = [
        SimulationStep(
            ts=step.ts,
            station_id=step.station_id,
            bikes_available=step.bikes_available,
            docks_available=None,
        )
        for step in output
    ]
    return SimulationResponse(steps=steps)
