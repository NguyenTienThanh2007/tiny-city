"""Application factory; secrets/settings remain exclusively on the backend."""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from tiny_city_api.routes import router
from .architect_routes import router as architect_router, RequestGate
from .architect_errors import ArchitectError
from .config import Settings
from .middleware import RequestBoundary
from .planner_bridge import PlannerBridge
from .providers import GeminiProvider, LocalRulesProvider, MockProvider


def create_app(*, cors_origins: list[str] | None = None, settings: Settings | None = None, provider=None, bridge=None) -> FastAPI:
    settings = settings or Settings()
    if cors_origins is None:
        cors_origins = [origin.strip() for origin in settings.tiny_city_cors_origins.split(',') if origin.strip()]
    application = FastAPI(title='TINY CITY API', version='0.2.0', description='Phase 2A AI city interpretation and authoritative TypeScript planning. The client owns the live simulation.')
    application.state.bridge = bridge if bridge is not None else PlannerBridge(settings)
    if provider is None:
        mode = settings.tiny_city_provider_mode
        provider = MockProvider() if mode == 'mock' else LocalRulesProvider(application.state.bridge) if mode == 'local' else GeminiProvider(settings)
    application.state.provider = provider
    application.state.gate = RequestGate(settings)
    application.state.settings = settings
    application.add_middleware(RequestBoundary, limit=settings.tiny_city_body_limit_bytes)
    application.add_middleware(CORSMiddleware, allow_origins=cors_origins, allow_credentials=False,
        allow_methods=['GET','POST'], allow_headers=['Content-Type'], expose_headers=['X-Request-ID'])

    @application.exception_handler(ArchitectError)
    async def architect_error(request: Request, error: ArchitectError):
        return JSONResponse({'requestId':request.state.request_id,'error':{'code':error.code,'message':error.message,'retryable':error.retryable}},status_code=error.status)

    @application.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError):
        return JSONResponse({'requestId':request.state.request_id,'error':{'code':'INVALID_REQUEST','message':'The request does not match the version-1 planning schema.','retryable':False}},status_code=422)

    def contract_error(request: Request, code: str, message: str, status: int, retryable: bool = False):
        request_id = getattr(request.state, 'request_id', 'unknown')
        return JSONResponse({'requestId': request_id, 'error': {'code': code, 'message': message, 'retryable': retryable}}, status_code=status)

    @application.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, error: StarletteHTTPException):
        # Every /v1 failure uses the documented error contract, so clients never see a bare {"detail": ...}.
        if not request.url.path.startswith('/v1/'):
            return JSONResponse({'detail': error.detail}, status_code=error.status_code)
        code = {404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED'}.get(error.status_code, 'HTTP_ERROR')
        return contract_error(request, code, f'{request.method} {request.url.path} is not a TINY CITY planning route.' if error.status_code in (404, 405)
            else 'The planning service could not handle this request.', error.status_code)

    @application.exception_handler(Exception)
    async def unexpected_error(request: Request, error: Exception):
        # Never leak internals; the request ID ties the response to the server log line.
        return contract_error(request, 'INTERNAL_ERROR', 'The planning service hit an unexpected error. Retry, or check the API log for this request ID.', 500, True)

    application.include_router(router)
    application.include_router(architect_router)
    return application


app = create_app()
