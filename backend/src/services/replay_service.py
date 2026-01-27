from __future__ import annotations

from __future__ import annotations

from datetime import datetime

from ..db.models import BinRecord
from ..db.queries import QueryRunner, fetch_replay_bins as query_replay_bins


def fetch_replay_bins(
    run_query: QueryRunner,
    start: datetime,
    end: datetime,
) -> list[BinRecord]:
    return list(query_replay_bins(run_query, start, end))
