import asyncio
import time
from collections import deque
from fastapi import APIRouter, Request
from .architect_errors import ArchitectError
from .architect_models import ErrorResponse, PlanningRequest, PlannerStatusResponse, ProviderStatus, ValidationRequest, PlanningResponse
from .planner_bridge import WORKER
from .providers import GeminiProvider, LocalRulesProvider, MockProvider

router = APIRouter(prefix='/v1/city', tags=['AI city architect'])
ERRORS = {code: {'model': ErrorResponse} for code in (409,413,422,429,502,503,504)}

class RequestGate:
    def __init__(self, settings):
        self.settings = settings
        self.inflight = 0
        self.starts: deque[float] = deque()

    def enter(self):
        now = time.monotonic()
        while self.starts and now-self.starts[0] >= 60:
            self.starts.popleft()
        if self.inflight >= self.settings.tiny_city_max_inflight:
            raise ArchitectError('SERVER_BUSY', 'The planning service is busy.', 503, True)
        if len(self.starts) >= self.settings.tiny_city_requests_per_minute:
            raise ArchitectError('PROVIDER_RATE_LIMIT', 'The local planning request limit was reached.', 429, True)
        self.starts.append(now)
        self.inflight += 1

@router.get('/status', response_model=PlannerStatusResponse)
async def planner_status(request: Request) -> PlannerStatusResponse:
    """Cheap readiness report for the client: never calls the AI provider or reveals credentials."""
    provider = request.app.state.provider
    settings = request.app.state.settings
    model = None
    if isinstance(provider, MockProvider):
        mode, configured = 'mock', True
    elif isinstance(provider, LocalRulesProvider):
        mode, configured = 'local', True
    elif isinstance(provider, GeminiProvider):
        mode, configured, model = 'gemini', bool(settings.gemini_api_key.get_secret_value().strip()), settings.gemini_model
    else:
        mode, configured = 'custom', True
    return PlannerStatusResponse(provider=ProviderStatus(mode=mode, configured=configured, model=model), planner='ready' if WORKER.is_file() else 'not-built')

async def disconnect_monitor(request: Request, stop: asyncio.Event):
    # An explicit stop flag ends the loop even if a cancellation is swallowed inside Starlette's
    # is_disconnected() cancel scope (that race used to leave fast-failing requests hanging forever).
    while not stop.is_set():
        if await request.is_disconnected():
            return
        try:
            await asyncio.wait_for(stop.wait(), 0.1)
        except TimeoutError:
            pass

async def execute(request: Request, data, interpret: bool):
    services = request.app.state
    services.gate.enter()
    async def work():
        context = await services.bridge.call('inspect', world=data.world, sourceRevision=data.sourceRevision)
        try:
            intent = await services.provider.interpret(data.prompt, context) if interpret else data.intent
        except ArchitectError:
            raise
        except Exception:
            raise ArchitectError('PROVIDER_UNAVAILABLE','The provider could not complete interpretation.',503,True) from None
        # Injected providers must obey the same strict schema as SDK responses.
        from .architect_models import ArchitectIntent
        from pydantic import ValidationError
        try:
            intent = ArchitectIntent.model_validate(intent)
        except ValidationError:
            raise ArchitectError('PROVIDER_INVALID_RESPONSE','The provider returned an invalid intent.',502) from None
        proposal = await services.bridge.call('plan', world=data.world, sourceRevision=data.sourceRevision,
            seed=data.seed, constraints=data.constraints.model_dump(), intent=intent.model_dump())
        return PlanningResponse(requestId=request.state.request_id, proposal=proposal)
    async def guarded():
        try:
            return await work()
        except ArchitectError:
            raise
        except Exception:
            # Unexpected failures still answer with the documented contract (no internals leak).
            raise ArchitectError('INTERNAL_ERROR', 'The planning service hit an unexpected error. Retry, or check the API log for this request ID.', 500, True) from None
    worker = asyncio.create_task(guarded())
    stop = asyncio.Event()
    disconnected = asyncio.create_task(disconnect_monitor(request, stop))
    try:
        done, _ = await asyncio.wait((worker,disconnected), return_when=asyncio.FIRST_COMPLETED)
        if worker in done:
            return await worker
        raise ArchitectError('REQUEST_CANCELLED','Planning was cancelled by the client.',499)
    finally:
        stop.set()
        for task in (worker,disconnected):
            if not task.done():
                task.cancel()
        await asyncio.gather(worker,disconnected,return_exceptions=True)
        services.gate.inflight -= 1

@router.post('/plan', response_model=PlanningResponse, responses=ERRORS)
async def plan(data: PlanningRequest, request: Request):
    return await execute(request,data,True)

@router.post('/plan/validate', response_model=PlanningResponse, responses=ERRORS)
async def validate(data: ValidationRequest, request: Request):
    return await execute(request,data,False)

@router.get('/catalog')
async def catalog(request: Request):
    from .planner_bridge import WORKER
    import json
    # The catalog is generated from the TS engine at build time, not maintained in Python.
    path = WORKER.parent / 'catalog.json'
    try:
        return json.loads(path.read_text())
    except (OSError,ValueError):
        raise ArchitectError('PLANNER_UNAVAILABLE','Build the planning workspace before starting the API.',503) from None
