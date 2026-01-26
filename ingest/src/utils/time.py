from __future__ import annotations

from datetime import datetime, timedelta, timezone


def floor_to_5min(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    minute = (value.minute // 5) * 5
    return value.replace(minute=minute, second=0, microsecond=0)


def ceil_to_5min(value: datetime) -> datetime:
    floored = floor_to_5min(value)
    if floored == value:
        return floored
    return floored + timedelta(minutes=5)
