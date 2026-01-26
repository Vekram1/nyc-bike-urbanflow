from __future__ import annotations

from pydantic import BaseModel


class MetricsSummary(BaseModel):
    failure_minutes: int | None = None
    unreliable_minutes: int | None = None
    hotspot_count: int | None = None
