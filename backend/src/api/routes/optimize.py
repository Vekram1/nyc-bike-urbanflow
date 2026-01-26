from __future__ import annotations

from fastapi import APIRouter


router = APIRouter()


@router.post("/optimize")
def optimize() -> dict[str, object]:
    return {}
