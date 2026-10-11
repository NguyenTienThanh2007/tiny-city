import asyncio
import time
from collections import deque
from fastapi import APIRouter, Request
from .architect_errors import ArchitectError
from .architect_models import ErrorResponse, PlanningRequest, ValidationRequest, PlanningResponse

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

async def disconnect_monitor(request: Request):
    while not await request.is_disconnected():
        await asyncio.sleep(0.1)

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
    worker = asyncio.create_task(work())
    disconnected = asyncio.create_task(disconnect_monitor(request))
    try:
        done, _ = await asyncio.wait((worker,disconnected), return_when=asyncio.FIRST_COMPLETED)
        if worker in done:
            return await worker
        raise ArchitectError('REQUEST_CANCELLED','Planning was cancelled by the client.',499)
    finally:
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
