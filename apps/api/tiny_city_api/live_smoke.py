"""Separately invoked paid smoke test. Ordinary CI never executes this module."""
import asyncio
import json
from .config import Settings
from .providers import GeminiProvider
from .planner_bridge import PlannerBridge
from .architect_errors import ArchitectError

async def main():
    settings=Settings()
    if not settings.gemini_api_key.get_secret_value().strip():
        print('NOT VERIFIED: GEMINI_API_KEY is missing. No live request was made.')
        return 2
    from pathlib import Path
    path=Path(__file__).resolve().parents[3]/'docs/ai-architect/examples/plan-request.json'
    data=json.loads(path.read_text())
    bridge=PlannerBridge(settings)
    try:
        context=await bridge.call('inspect',world=data['world'],sourceRevision=data['sourceRevision'])
        intent=await GeminiProvider(settings).interpret('Build one park. Preserve all existing buildings and roads.',context)
        proposal=await bridge.call('plan',world=data['world'],sourceRevision=data['sourceRevision'],intent=intent.model_dump(),seed=7)
        if not proposal['validation']['valid']:
            print('FAIL: live provider returned an unfulfillable plan.');return 1
        print(json.dumps({'result':'PASS','model':settings.gemini_model,'planId':proposal['planId'],'estimatedCost':proposal['estimatedCost']}))
        return 0
    except ArchitectError as error:
        print(f'FAIL: {error.code}');return 1

if __name__=='__main__': raise SystemExit(asyncio.run(main()))
