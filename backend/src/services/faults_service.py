from __future__ import annotations

from backend.api.schemas.faults import FaultSummary


def fetch_faults() -> FaultSummary:
    return FaultSummary(operational_faults=[], unreliable_faults=[])
