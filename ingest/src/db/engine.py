from __future__ import annotations

import os
from collections.abc import Sequence


def postgres_dsn() -> str:
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    database = os.getenv("POSTGRES_DB", "urbanflow")
    user = os.getenv("POSTGRES_USER", "urbanflow")
    password = os.getenv("POSTGRES_PASSWORD", "urbanflow")

    return f"postgresql://{user}:{password}@{host}:{port}/{database}"


def execute_sql(_: str, __: Sequence[object]) -> None:
    return None
