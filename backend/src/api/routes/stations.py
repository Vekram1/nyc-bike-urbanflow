from __future__ import annotations

from fastapi import APIRouter


router = APIRouter()


@router.get("/stations")
def list_stations() -> list[dict[str, object]]:
    return []
