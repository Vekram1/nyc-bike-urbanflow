from __future__ import annotations

from backend.simulator.inventory import clamp_inventory


def test_clamp_inventory_caps_high_value() -> None:
    assert clamp_inventory(10, 5) == 5


def test_clamp_inventory_caps_low_value() -> None:
    assert clamp_inventory(-3, 5) == 0
