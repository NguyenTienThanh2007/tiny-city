"""Application factory, with explicit local development CORS configuration."""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from tiny_city_api.routes import router


def create_app(*, cors_origins: list[str] | None = None) -> FastAPI:
    if cors_origins is None:
        configured = os.getenv(
            "TINY_CITY_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        )
        cors_origins = [origin.strip() for origin in configured.split(",") if origin.strip()]

    application = FastAPI(
        title="TINY CITY API",
        version="0.0.0",
        description="Phase 0 backend scaffold. Simulation runs in the TypeScript package.",
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Content-Type"],
    )
    application.include_router(router)
    return application


app = create_app()
