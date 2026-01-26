from __future__ import annotations

from fastapi import APIRouter


router = APIRouter()


@router.post("/simulate")
def simulate() -> dict[str, object]:
    return {}
