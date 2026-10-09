"""Scaffold routes; simulation contracts remain in the TypeScript package."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["tiny-city-api"] = "tiny-city-api"
    phase: Literal[0] = 0


@router.get("/health", response_model=HealthResponse, tags=["health"])
def health() -> HealthResponse:
    return HealthResponse()
