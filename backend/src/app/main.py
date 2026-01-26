from __future__ import annotations

from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="UrbanFlow Twin API")
    return app


app = create_app()
