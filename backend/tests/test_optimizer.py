from __future__ import annotations

from backend.optimizer.tie_breakers import TieBreakerScore, compare_scores


def test_compare_scores_prefers_lower_tuple() -> None:
    left = TieBreakerScore(moves=1, travel_minutes=10, quantity=5)
    right = TieBreakerScore(moves=2, travel_minutes=5, quantity=1)

    assert compare_scores(left, right)
