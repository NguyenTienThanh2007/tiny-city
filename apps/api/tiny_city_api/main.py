"""Application factory; secrets/settings remain exclusively on the backend."""
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from tiny_city_api.routes import router
from .architect_routes import router as architect_router, RequestGate
from .architect_errors import ArchitectError
from .auth_routes import router as auth_router, users_router, dev_router
from .city_save_routes import router as city_save_router
from .config import Settings
from .database import create_database_engine, create_session_factory
from .email_service import create_email_sender
from .middleware import RequestBoundary, SecurityHeaders
from .planner_bridge import PlannerBridge
from .providers import GeminiProvider, LocalRulesProvider, MockProvider
from .security import ApiError


def create_app(*, cors_origins: list[str] | None = None, settings: Settings | None = None,
               provider=None, bridge=None, email_sender=None, database_url: str | None = None) -> FastAPI:
    settings = settings or Settings()
    if database_url is not None:
        settings = settings.model_copy(update={'database_url': database_url})
    if cors_origins is None:
        cors_origins = [origin.strip() for origin in settings.tiny_city_cors_origins.split(',') if origin.strip()]
    if not cors_origins or '*' in cors_origins:
        raise ValueError('CORS origins must be explicitly listed; wildcard origins cannot be used with credentials.')
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        app.state.db_engine.dispose()
    application = FastAPI(title='TINY CITY API', version='0.3.0',
        description='TINY CITY planning, accounts, sessions, and owner-scoped city saves.', lifespan=lifespan)
    application.state.bridge = bridge if bridge is not None else PlannerBridge(settings)
    if provider is None:
        mode = settings.tiny_city_provider_mode
        provider = MockProvider() if mode == 'mock' else LocalRulesProvider(application.state.bridge) if mode == 'local' else GeminiProvider(settings)
    application.state.provider = provider
    application.state.gate = RequestGate(settings)
    application.state.settings = settings
    application.state.db_engine = create_database_engine(settings.database_url)
    application.state.session_factory = create_session_factory(application.state.db_engine)
    application.state.email_sender = email_sender if email_sender is not None else create_email_sender(settings)
    application.add_middleware(RequestBoundary, limit=settings.tiny_city_body_limit_bytes,
        cloud_save_limit=settings.max_cloud_save_bytes + 16_384)
    application.add_middleware(SecurityHeaders, secure=settings.session_cookie_secure)
    application.add_middleware(CORSMiddleware, allow_origins=cors_origins, allow_credentials=True,
        allow_methods=['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
        allow_headers=['Content-Type','X-CSRF-Token'], expose_headers=['X-Request-ID'])

    @application.exception_handler(ApiError)
    async def api_error(request: Request, error: ApiError):
        return JSONResponse({'error': {'code': error.code, 'message': error.message}}, status_code=error.status_code)

    @application.exception_handler(ArchitectError)
    async def architect_error(request: Request, error: ArchitectError):
        return JSONResponse({'requestId':request.state.request_id,'error':{'code':error.code,'message':error.message,'retryable':error.retryable}},status_code=error.status)

    @application.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError):
        if request.url.path.startswith(('/v1/auth/', '/v1/users/')):
            return JSONResponse({'error': {'code':'INVALID_REQUEST','message':'Check the submitted fields and try again.'}}, status_code=422)
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
        return contract_error(request, code, 'The requested TINY CITY API route is unavailable.' if error.status_code in (404, 405)
            else 'The API could not handle this request.', error.status_code)

    @application.exception_handler(Exception)
    async def unexpected_error(request: Request, error: Exception):
        # Never leak internals; the request ID ties the response to the server log line.
        return contract_error(request, 'INTERNAL_ERROR', 'The planning service hit an unexpected error. Retry, or check the API log for this request ID.', 500, True)

    application.include_router(router)
    application.include_router(architect_router)
    application.include_router(auth_router)
    application.include_router(users_router)
    application.include_router(city_save_router)
    application.include_router(dev_router)
    return application


app = create_app()
