from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def feed_timestamp(payload: dict[str, Any]) -> datetime | None:
    timestamp = payload.get("last_updated")
    if timestamp is None:
        return None
    return datetime.fromtimestamp(int(timestamp), tz=timezone.utc)


def is_feed_advanced(previous: datetime | None, current: datetime | None) -> bool:
    if previous is None or current is None:
        return True
    return current > previous
