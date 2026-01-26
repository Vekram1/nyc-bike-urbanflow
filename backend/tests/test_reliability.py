from __future__ import annotations

from backend.core import reliability


def test_mark_unreliable_sets_reason() -> None:
    result = reliability.mark_unreliable("offline")

    assert not result.is_reliable
    assert result.reason == "offline"
