from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..api.routes import metrics, replay, state, stations


def create_app() -> FastAPI:
    app = FastAPI(title="UrbanFlow Twin API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(stations.router)
    app.include_router(state.router)
    app.include_router(replay.router)
    app.include_router(metrics.router)

    @app.get("/")
    def root() -> dict[str, str]:
        return {"status": "ok", "service": "urbanflow-backend"}

    return app


app = create_app()
