from __future__ import annotations

from backend.optimizer.constraints import has_feasible_plan


def test_has_feasible_plan_false_for_zero() -> None:
    assert not has_feasible_plan(0)


def test_has_feasible_plan_true_for_positive() -> None:
    assert has_feasible_plan(3)
