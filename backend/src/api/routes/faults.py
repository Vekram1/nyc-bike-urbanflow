from __future__ import annotations

from fastapi import APIRouter


router = APIRouter()


@router.get("/faults")
def get_faults() -> dict[str, object]:
    return {}
