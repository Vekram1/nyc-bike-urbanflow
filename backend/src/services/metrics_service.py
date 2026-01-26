from __future__ import annotations

from backend.api.schemas.metrics import MetricsSummary


def fetch_metrics() -> MetricsSummary:
    return MetricsSummary()
