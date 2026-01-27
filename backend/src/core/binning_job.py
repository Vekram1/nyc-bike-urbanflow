from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

from .binning import BinRow, compute_deltas


def build_bins(rows: Iterable[BinRow]) -> list[tuple[BinRow, int | None, int | None]]:
    return compute_deltas(rows)


def bin_window(start: datetime, end: datetime) -> tuple[datetime, datetime]:
    return start, end
