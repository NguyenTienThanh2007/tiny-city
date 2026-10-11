"""Bounded JSON-only subprocess bridge to the one authoritative TS rules engine."""
import asyncio
import json
import os
from pathlib import Path
from .architect_errors import ArchitectError
from .config import Settings

WORKER = Path(__file__).resolve().parents[3] / 'packages/ai-architect/dist/worker.js'

class PlannerBridge:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def call(self, action: str, **payload):
        data = json.dumps({'action': action, **payload}, ensure_ascii=False).encode()
        if len(data) > self.settings.tiny_city_body_limit_bytes:
            raise ArchitectError('REQUEST_TOO_LARGE', 'Planning input exceeds the size limit.', 413)
        if not WORKER.is_file():
            raise ArchitectError('PLANNER_UNAVAILABLE', 'Build the TypeScript planning workspace before starting the API.', 503)
        # Credentials are deliberately excluded from the subprocess environment.
        env = {key: os.environ[key] for key in ('PATH','SYSTEMROOT','LANG','LC_ALL') if key in os.environ}
        try:
            process = await asyncio.create_subprocess_exec(self.settings.tiny_city_node_binary, str(WORKER),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, env=env)
        except OSError:
            raise ArchitectError('PLANNER_UNAVAILABLE', 'The configured Node.js runtime is unavailable.', 503) from None
        try:
            output, _ = await asyncio.wait_for(process.communicate(data), self.settings.tiny_city_planner_timeout_seconds)
        except (TimeoutError, asyncio.CancelledError) as error:
            if process.returncode is None:
                process.kill()
            await process.wait()
            if isinstance(error, asyncio.CancelledError):
                raise
            raise ArchitectError('PLANNER_TIMEOUT', 'Deterministic planning timed out.', 504, True) from None
        if process.returncode != 0 or len(output) > 1048576:
            raise ArchitectError('PLANNER_UNAVAILABLE', 'The planner could not complete the request.', 503)
        try:
            result = json.loads(output)
            if not result['ok']:
                detail = result['error']
                raise ArchitectError(detail['code'], detail['message'], 409 if detail['code'] == 'STALE_WORLD' else 422)
            return result['data']
        except (ValueError, KeyError, TypeError):
            raise ArchitectError('PLANNER_UNAVAILABLE', 'The planner returned an invalid response.', 503) from None
