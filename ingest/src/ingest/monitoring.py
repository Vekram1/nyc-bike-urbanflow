from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class FeedLag:
    lag_seconds: float


def compute_lag(now: datetime, feed_ts: datetime) -> FeedLag:
    return FeedLag(lag_seconds=(now - feed_ts).total_seconds())
