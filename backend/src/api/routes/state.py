from __future__ import annotations

from fastapi import APIRouter


router = APIRouter()


@router.get("/state")
def get_state() -> dict[str, object]:
    return {}
