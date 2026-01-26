from __future__ import annotations

from backend.api.schemas.optimize import OptimizeResponse


def run_optimization() -> OptimizeResponse:
    return OptimizeResponse(status="no_plan", reason="not_implemented")
