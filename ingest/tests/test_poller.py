from __future__ import annotations

from datetime import datetime, timezone

from ingest.ingest import validators


def test_is_feed_advanced_accepts_new_timestamp() -> None:
    previous = datetime(2024, 1, 1, tzinfo=timezone.utc)
    current = datetime(2024, 1, 2, tzinfo=timezone.utc)

    assert validators.is_feed_advanced(previous, current)


def test_is_feed_advanced_rejects_same_timestamp() -> None:
    timestamp = datetime(2024, 1, 1, tzinfo=timezone.utc)

    assert not validators.is_feed_advanced(timestamp, timestamp)
