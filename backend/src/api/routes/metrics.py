from __future__ import annotations

from fastapi import APIRouter


router = APIRouter()


@router.get("/metrics")
def get_metrics() -> dict[str, object]:
    return {}
