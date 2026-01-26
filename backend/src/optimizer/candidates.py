from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CandidateMove:
    donor_station_id: str
    receiver_station_id: str
    quantity: int
