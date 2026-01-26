from __future__ import annotations

from fastapi import APIRouter


router = APIRouter()


@router.get("/replay")
def get_replay() -> list[dict[str, object]]:
    return []
