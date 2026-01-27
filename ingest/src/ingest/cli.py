from __future__ import annotations

from .poller import ingest_handler, run_polling


def main() -> None:
    run_polling(ingest_handler)


if __name__ == "__main__":
    main()
