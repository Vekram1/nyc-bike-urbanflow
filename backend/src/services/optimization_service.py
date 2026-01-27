from __future__ import annotations

from __future__ import annotations

from ..api.schemas.optimize import OptimizeResponse
from ..optimizer.candidates import build_candidates, score_candidates


def run_optimization() -> OptimizeResponse:
    candidates = build_candidates(["donor"], ["receiver"], quantity=1)
    scored = score_candidates(candidates)
    if not scored:
        return OptimizeResponse(status="no_plan", reason="no_candidates")
    return OptimizeResponse(status="plan", reason=None)
