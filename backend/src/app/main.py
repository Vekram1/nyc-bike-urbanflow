from __future__ import annotations

from fastapi import FastAPI

from ..api.routes import replay, state, stations


def create_app() -> FastAPI:
    app = FastAPI(title="UrbanFlow Twin API")
    app.include_router(stations.router)
    app.include_router(state.router)
    app.include_router(replay.router)
    return app


app = create_app()
