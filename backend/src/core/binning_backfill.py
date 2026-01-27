from __future__ import annotations

from datetime import datetime


def backfill_window(start: datetime, end: datetime) -> tuple[datetime, datetime]:
    return start, end
