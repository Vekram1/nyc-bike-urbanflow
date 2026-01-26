from __future__ import annotations

import os


def postgres_dsn() -> str:
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    database = os.getenv("POSTGRES_DB", "urbanflow")
    user = os.getenv("POSTGRES_USER", "urbanflow")
    password = os.getenv("POSTGRES_PASSWORD", "urbanflow")

    return f"postgresql://{user}:{password}@{host}:{port}/{database}"
