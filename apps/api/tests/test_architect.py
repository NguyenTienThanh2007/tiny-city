import asyncio
import copy
import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from tiny_city_api.architect_models import ArchitectIntent
from tiny_city_api.architect_errors import ArchitectError
from tiny_city_api.config import Settings
from tiny_city_api.main import create_app

EXAMPLES=Path(__file__).resolve().parents[3]/'docs/ai-architect/examples'

def request():
    return json.loads((EXAMPLES/'plan-request.json').read_text())

def intent(language='en'):
    return ArchitectIntent(summary='Build two villas and a park',language=language, budgetLimit=1000,
        builds=[{'buildingType':'villa','quantity':2},{'buildingType':'park','quantity':1}])

class FakeProvider:
    def __init__(self, result=None):
        self.result=result or intent()
        self.calls=[]
    async def interpret(self,prompt,context):
        self.calls.append((prompt,context));return self.result

def settings(**kwargs):
    return Settings(_env_file=None,gemini_api_key='',**kwargs)

@pytest.mark.parametrize('language,prompt',[('en','Build 2 villas and a park'),('vi','Xây thêm 2 biệt thự và một công viên; không phá công trình cũ')])
def test_bilingual_provider_and_real_ts_planner(language,prompt):
    provider=FakeProvider(intent(language));data=request();data['prompt']=prompt;before=copy.deepcopy(data)
    with TestClient(create_app(settings=settings(),provider=provider)) as client:
        response=client.post('/v1/city/plan',json=data)
        assert response.status_code==200,response.text
        result=response.json();proposal=result['proposal']
        assert proposal['validation']['valid'] and len(proposal['placements'])==3
        assert proposal['intent']['language']==language
        assert proposal['estimatedCost']<=1000
        assert provider.calls[0][0]==prompt
        assert set(provider.calls[0][1]['catalog'])=={'villa','duplex','townhouse','apartment','park','clubhouse','pool','mall','office'}
        assert response.headers['x-request-id']==result['requestId']
    assert data==before

def test_missing_key_is_explicit_and_validate_is_offline():
    with TestClient(create_app(settings=settings())) as client:
        response=client.post('/v1/city/plan',json=request())
        assert response.status_code==503
        assert response.json()['error']['code']=='PROVIDER_NOT_CONFIGURED'
        data=request();data.pop('prompt');data['intent']=intent().model_dump()
        a=client.post('/v1/city/plan/validate',json=data);b=client.post('/v1/city/plan/validate',json=data)
        assert a.status_code==b.status_code==200
        assert a.json()['proposal']==b.json()['proposal']
        fixture=json.loads((EXAMPLES/'mock-plan-response.json').read_text())
        assert a.json()['proposal']==fixture['proposal']

def test_invalid_world_or_stale_revision_never_calls_provider():
    provider=FakeProvider()
    with TestClient(create_app(settings=settings(),provider=provider)) as client:
        for patch,code in [({'world':{}},'INVALID_WORLD'),({'sourceRevision':123},'STALE_WORLD')]:
            response=client.post('/v1/city/plan',json={**request(),**patch});assert response.json()['error']['code']==code
    assert not provider.calls

@pytest.mark.parametrize('patch',[{'contractVersion':True},{'prompt':'  '},{'prompt':'x'*4001},{'prompt':''},{'sourceRevision':True},{'seed':-1},{'constraints':{'maxOperations':129}},{'shellCommand':'ls'}])
def test_input_limits_and_strict_schema(patch):
    provider=FakeProvider()
    with TestClient(create_app(settings=settings(),provider=provider)) as client:
        response=client.post('/v1/city/plan',json={**request(),**patch})
        assert response.status_code==422 and response.json()['error']['code']=='INVALID_REQUEST'
        assert not provider.calls

def test_body_limit_and_rate_guards():
    with TestClient(create_app(settings=settings(tiny_city_body_limit_bytes=1024),provider=FakeProvider())) as client:
        response=client.post('/v1/city/plan',content=b' '*2048,headers={'Content-Type':'application/json'})
        assert response.status_code==413 and response.json()['error']['code']=='REQUEST_TOO_LARGE'
    with TestClient(create_app(settings=settings(tiny_city_requests_per_minute=1),provider=FakeProvider())) as client:
        assert client.post('/v1/city/plan',json=request()).status_code==200
        assert client.post('/v1/city/plan',json=request()).status_code==429

def test_catalog_openapi_and_post_cors():
    with TestClient(create_app(settings=settings())) as client:
        catalog=client.get('/v1/city/catalog').json()
        assert catalog['catalog']['mall']['cost']==900 and catalog['limits']['operations']==128
        schema=client.get('/openapi.json').json()
        assert '/v1/city/plan/validate' in schema['paths'] and '/v1/city/apply' not in schema['paths']
        response=client.options('/v1/city/plan',headers={'Origin':'http://localhost:5173','Access-Control-Request-Method':'POST'})
        assert response.status_code==200 and response.headers['access-control-allow-origin']=='http://localhost:5173'

@pytest.mark.parametrize('allow_partial,valid,count',[(False,False,0),(True,True,1)])
def test_budget_repair_and_partial_consent(allow_partial,valid,count):
    data=request();data.pop('prompt');data['intent']=intent().model_dump();data['intent']['builds']=[{'buildingType':'villa','quantity':2}]
    data['constraints']={'budgetLimit':120,'allowPartial':allow_partial}
    with TestClient(create_app(settings=settings())) as client:
        response=client.post('/v1/city/plan/validate',json=data)
        assert response.status_code==200
        proposal=response.json()['proposal'];assert proposal['validation']['valid']==valid and len(proposal['placements'])==count
        assert any(w['code']=='QUANTITY_UNFULFILLED' for w in proposal['warnings'])

def test_unsupported_provider_response_is_not_trusted():
    with TestClient(create_app(settings=settings(),provider=FakeProvider({'summary':'bad','language':'en','builds':[{'buildingType':'airport','quantity':1}]}))) as client:
        response=client.post('/v1/city/plan',json=request())
        assert response.status_code==502 and response.json()['error']['code']=='PROVIDER_INVALID_RESPONSE'

@pytest.mark.parametrize('code,status',[('PROVIDER_TIMEOUT',504),('PROVIDER_UNAVAILABLE',503),('PROVIDER_AUTH',502)])
def test_provider_errors_and_sanitized_logging(code,status,caplog):
    class FailedProvider:
        async def interpret(self,prompt,context):
            raise ArchitectError(code,'Safe failure.',status)
    with TestClient(create_app(settings=settings(),provider=FailedProvider())) as client:
        data=request();data['prompt']='private prompt content';response=client.post('/v1/city/plan',json=data)
        assert response.status_code==status and response.json()['error']['code']==code
    assert 'private prompt content' not in caplog.text

def test_settings_env_file_and_shell_precedence(tmp_path,monkeypatch):
    env=tmp_path/'.env';env.write_text('GEMINI_API_KEY=test-placeholder\nGEMINI_MODEL=gemini-test\n')
    monkeypatch.setenv('GEMINI_MODEL','gemini-shell')
    config=Settings(_env_file=env)
    assert config.gemini_model=='gemini-shell' and 'test-placeholder' not in repr(config)

def test_bridge_unavailable_and_cancellation(monkeypatch):
    from tiny_city_api.planner_bridge import PlannerBridge
    from tiny_city_api import planner_bridge
    monkeypatch.setattr(planner_bridge,'WORKER',Path('/missing/worker.js'))
    with pytest.raises(ArchitectError) as error:
        asyncio.run(PlannerBridge(settings()).call('inspect',world={},sourceRevision=0))
    assert error.value.code=='PLANNER_UNAVAILABLE'

@pytest.mark.parametrize('cancel',[False,True])
def test_real_bridge_timeout_and_cancellation_kill_child(tmp_path,monkeypatch,cancel):
    from tiny_city_api import planner_bridge
    script=tmp_path/'slow.mjs';script.write_text('await new Promise(resolve => setTimeout(resolve, 10000));')
    monkeypatch.setattr(planner_bridge,'WORKER',script)
    bridge=planner_bridge.PlannerBridge(settings(tiny_city_planner_timeout_seconds=1))
    async def run():
        if cancel:
            task=asyncio.create_task(bridge.call('inspect',world={},sourceRevision=0));await asyncio.sleep(.05);task.cancel()
            with pytest.raises(asyncio.CancelledError): await task
        else:
            with pytest.raises(ArchitectError) as failure: await bridge.call('inspect',world={},sourceRevision=0)
            assert failure.value.code=='PLANNER_TIMEOUT'
    asyncio.run(run())

def test_planner_process_does_not_inherit_provider_key(tmp_path,monkeypatch):
    from tiny_city_api import planner_bridge
    script=tmp_path/'inspect.mjs';script.write_text("process.stdout.write(JSON.stringify({ok:true,data:{credentialPresent:!!process.env.GEMINI_API_KEY}}));")
    monkeypatch.setattr(planner_bridge,'WORKER',script);monkeypatch.setenv('GEMINI_API_KEY','test-placeholder')
    result=asyncio.run(planner_bridge.PlannerBridge(settings()).call('inspect',world={},sourceRevision=0))
    assert result=={'credentialPresent':False}
