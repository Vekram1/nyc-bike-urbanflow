from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from ...services.optimization_service import run_optimization


router = APIRouter()


@router.post("/optimize")
def optimize() -> dict[str, Any]:
    result = run_optimization()
    return {
        "status": result.status,
        "reason": result.reason,
    }
