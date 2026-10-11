"""Application factory; secrets/settings remain exclusively on the backend."""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from tiny_city_api.routes import router
from .architect_routes import router as architect_router, RequestGate
from .architect_errors import ArchitectError
from .config import Settings
from .middleware import RequestBoundary
from .planner_bridge import PlannerBridge
from .providers import GeminiProvider, MockProvider


def create_app(*, cors_origins: list[str] | None = None, settings: Settings | None = None, provider=None, bridge=None) -> FastAPI:
    settings = settings or Settings()
    if cors_origins is None:
        cors_origins = [origin.strip() for origin in settings.tiny_city_cors_origins.split(',') if origin.strip()]
    application = FastAPI(title='TINY CITY API', version='0.2.0', description='Phase 2A AI city interpretation and authoritative TypeScript planning. The client owns the live simulation.')
    application.state.provider = provider if provider is not None else MockProvider() if settings.tiny_city_provider_mode == 'mock' else GeminiProvider(settings)
    application.state.bridge = bridge if bridge is not None else PlannerBridge(settings)
    application.state.gate = RequestGate(settings)
    application.add_middleware(RequestBoundary, limit=settings.tiny_city_body_limit_bytes)
    application.add_middleware(CORSMiddleware, allow_origins=cors_origins, allow_credentials=False,
        allow_methods=['GET','POST'], allow_headers=['Content-Type'], expose_headers=['X-Request-ID'])

    @application.exception_handler(ArchitectError)
    async def architect_error(request: Request, error: ArchitectError):
        return JSONResponse({'requestId':request.state.request_id,'error':{'code':error.code,'message':error.message,'retryable':error.retryable}},status_code=error.status)

    @application.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError):
        return JSONResponse({'requestId':request.state.request_id,'error':{'code':'INVALID_REQUEST','message':'The request does not match the version-1 planning schema.','retryable':False}},status_code=422)

    application.include_router(router)
    application.include_router(architect_router)
    return application


app = create_app()
