from __future__ import annotations

import os


def _get_env(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if value is None:
        raise ValueError(f"Missing required environment variable: {name}")
    return value


def gbfs_base_url() -> str:
    return _get_env("GBFS_BASE_URL", "https://gbfs.citibikenyc.com/gbfs/en")


def station_information_url() -> str:
    return _get_env(
        "GBFS_STATION_INFORMATION_URL",
        "https://gbfs.citibikenyc.com/gbfs/en/station_information.json",
    )


def station_status_url() -> str:
    return _get_env(
        "GBFS_STATION_STATUS_URL",
        "https://gbfs.citibikenyc.com/gbfs/en/station_status.json",
    )


def postgres_host() -> str:
    return _get_env("POSTGRES_HOST", "localhost")


def postgres_port() -> int:
    return int(_get_env("POSTGRES_PORT", "5432"))


def postgres_db() -> str:
    return _get_env("POSTGRES_DB", "urbanflow")


def postgres_user() -> str:
    return _get_env("POSTGRES_USER", "urbanflow")


def postgres_password() -> str:
    return _get_env("POSTGRES_PASSWORD", "urbanflow")
