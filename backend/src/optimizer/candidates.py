from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CandidateMove:
    donor_station_id: str
    receiver_station_id: str
    quantity: int


def build_candidates(
    donor_ids: list[str],
    receiver_ids: list[str],
    quantity: int,
) -> list[CandidateMove]:
    candidates: list[CandidateMove] = []
    for donor in donor_ids:
        for receiver in receiver_ids:
            if donor == receiver:
                continue
            candidates.append(
                CandidateMove(
                    donor_station_id=donor,
                    receiver_station_id=receiver,
                    quantity=quantity,
                )
            )
    return candidates
