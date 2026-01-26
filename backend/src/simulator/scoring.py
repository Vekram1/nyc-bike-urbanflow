from __future__ import annotations


def failure_minutes(
    is_empty: bool | None,
    is_full: bool | None,
    is_reliable: bool = True,
) -> int:
    if not is_reliable:
        return 0
    empty = 1 if is_empty else 0
    full = 1 if is_full else 0
    return empty + full
