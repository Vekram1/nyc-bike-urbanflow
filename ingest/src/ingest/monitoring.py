from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class FeedLag:
    lag_seconds: float


@dataclass(frozen=True)
class FeedStatus:
    lag_seconds: float
    is_stale: bool


def compute_lag(now: datetime, feed_ts: datetime) -> FeedLag:
    return FeedLag(lag_seconds=(now - feed_ts).total_seconds())


def compute_status(
    now: datetime, feed_ts: datetime, stale_after: float = 300
) -> FeedStatus:
    lag = compute_lag(now, feed_ts)
    return FeedStatus(
        lag_seconds=lag.lag_seconds, is_stale=lag.lag_seconds > stale_after
    )
