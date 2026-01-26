from __future__ import annotations

from collections.abc import Iterator


def get_db_session() -> Iterator[None]:
    yield None
