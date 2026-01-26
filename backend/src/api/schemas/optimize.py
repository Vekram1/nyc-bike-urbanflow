from __future__ import annotations

from pydantic import BaseModel


class OptimizeRequest(BaseModel):
    horizon_minutes: int
    trucks: int
    capacity: int


class OptimizeResponse(BaseModel):
    status: str
    reason: str | None = None
