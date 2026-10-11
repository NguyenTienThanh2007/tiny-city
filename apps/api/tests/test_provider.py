import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
import pytest
from google.genai import errors
from tiny_city_api.architect_errors import ArchitectError
from tiny_city_api.architect_models import ArchitectIntent
from tiny_city_api.config import Settings
from tiny_city_api.providers import GeminiProvider, gemini_intent_schema

class AsyncClient:
    def __init__(self, generate):
        self.models=SimpleNamespace(generate_content=generate)
        self.closed=False
    async def __aenter__(self): return self
    async def __aexit__(self,*args): self.closed=True

def setup(monkeypatch, side_effect=None, text=None, **config):
    from tiny_city_api import providers
    generate=AsyncMock(side_effect=side_effect, return_value=SimpleNamespace(text=text))
    async_client=AsyncClient(generate)
    client=SimpleNamespace(aio=async_client,close=MagicMock())
    factory=MagicMock(return_value=client);monkeypatch.setattr(providers.genai,'Client',factory)
    settings=Settings(_env_file=None,gemini_api_key='test-placeholder',**config)
    return GeminiProvider(settings),generate,async_client,client,factory

@pytest.mark.parametrize('language,prompt',[('en','Build one office'),('vi','Xây một văn phòng; giữ nguyên khu cũ')])
def test_sdk_structured_schema_and_limits(monkeypatch,language,prompt):
    intent=ArchitectIntent(summary='One office',language=language,builds=[{'buildingType':'office','quantity':1}])
    provider,generate,aio,client,factory=setup(monkeypatch,text=intent.model_dump_json())
    result=asyncio.run(provider.interpret(prompt,{'catalog':{'office':{}}}))
    assert result==intent and generate.await_count==1 and aio.closed
    args=generate.call_args.kwargs
    assert json.loads(args['contents'])['userRequest']==prompt
    assert args['config'].response_schema is None
    assert args['config'].response_json_schema==gemini_intent_schema()
    assert args['config'].max_output_tokens==4096 and args['config'].tools is None
    assert factory.call_args.kwargs['http_options'].retry_options.attempts==1
    client.close.assert_called_once()

@pytest.mark.parametrize('code,retryable,expected',[(503,True,'PROVIDER_UNAVAILABLE'),(429,True,'PROVIDER_RATE_LIMIT'),(401,False,'PROVIDER_AUTH'),(400,False,'PROVIDER_INVALID_RESPONSE')])
def test_bounded_retry_and_no_sensitive_exception_echo(monkeypatch,code,retryable,expected):
    error=errors.APIError(code,{'error':{'message':'private provider message test-placeholder'}})
    provider,generate,aio,client,_=setup(monkeypatch,side_effect=error)
    with pytest.raises(ArchitectError) as failure:
        asyncio.run(provider.interpret('private prompt',{}))
    assert failure.value.code==expected and failure.value.retryable==retryable
    assert generate.await_count==(2 if retryable else 1)
    assert 'private' not in failure.value.message and 'test-placeholder' not in failure.value.message
    assert aio.closed;client.close.assert_called_once()

def test_retry_can_recover(monkeypatch):
    intent=ArchitectIntent(summary='One park',language='en',builds=[{'buildingType':'park','quantity':1}])
    provider,generate,_,_,_=setup(monkeypatch,side_effect=[errors.APIError(503,{}),SimpleNamespace(text=intent.model_dump_json())])
    assert asyncio.run(provider.interpret('one park',{}))==intent and generate.await_count==2

@pytest.mark.parametrize('text',['{}','not-json',json.dumps({'summary':'bad','language':'en','builds':[{'buildingType':'airport','quantity':1}]}),None])
def test_invalid_responses_are_not_retried(monkeypatch,text):
    provider,generate,_,_,_=setup(monkeypatch,text=text)
    with pytest.raises(ArchitectError) as failure: asyncio.run(provider.interpret('test',{}))
    assert failure.value.code=='PROVIDER_INVALID_RESPONSE' and generate.await_count==1

def test_timeout_is_bounded_and_cancelled(monkeypatch):
    async def hanging(**kwargs): await asyncio.sleep(10)
    provider,generate,aio,_,_=setup(monkeypatch,side_effect=hanging,gemini_timeout_seconds=1,gemini_retries=0)
    with pytest.raises(ArchitectError) as failure: asyncio.run(provider.interpret('test',{}))
    assert failure.value.code=='PROVIDER_TIMEOUT' and generate.await_count==1 and aio.closed

def test_cancellation_is_not_retried(monkeypatch):
    async def hanging(**kwargs): await asyncio.sleep(10)
    provider,generate,aio,_,_=setup(monkeypatch,side_effect=hanging)
    async def run():
        task=asyncio.create_task(provider.interpret('test',{}));await asyncio.sleep(.01);task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
    asyncio.run(run());assert generate.await_count==1 and aio.closed

def test_missing_key_and_context_limits_do_not_construct_client(monkeypatch):
    from tiny_city_api import providers
    factory=MagicMock();monkeypatch.setattr(providers.genai,'Client',factory)
    for config,prompt,code in [(dict(gemini_api_key=''),'test','PROVIDER_NOT_CONFIGURED'),
                               (dict(gemini_api_key='test-placeholder',gemini_max_context_chars=1000),'x'*2000,'CONTEXT_LIMIT')]:
        with pytest.raises(ArchitectError) as failure:
            asyncio.run(GeminiProvider(Settings(_env_file=None,**config)).interpret(prompt,{}))
        assert failure.value.code==code
    factory.assert_not_called()

def test_real_sdk_serializes_strict_json_schema_without_legacy_fields(monkeypatch):
    """Exercise the SDK's real HTTP serialization, which a fake Client bypasses."""
    import httpx
    from tiny_city_api import providers
    original_client=providers.genai.Client
    intent=ArchitectIntent(summary='One park',language='en',builds=[{'buildingType':'park','quantity':1}])
    bodies=[]
    def handle(request):
        body=json.loads(request.content);bodies.append(body)
        generation=body['generationConfig']
        if 'responseSchema' in generation:
            return httpx.Response(400,json={'error':{'code':400,'message':'Unsupported additional_properties'}})
        assert generation['responseJsonSchema']==gemini_intent_schema()
        assert generation['responseJsonSchema']['additionalProperties'] is False
        assert generation['responseJsonSchema']['properties']['builds']['items']['additionalProperties'] is False
        return httpx.Response(200,json={'candidates':[{'content':{'parts':[{'text':intent.model_dump_json()}]},'finishReason':'STOP'}]})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as transport:
            def factory(**kwargs):
                kwargs['http_options'].httpx_async_client=transport
                return original_client(**kwargs)
            monkeypatch.setattr(providers.genai,'Client',factory)
            settings=Settings(_env_file=None,gemini_api_key='test-placeholder')
            return await GeminiProvider(settings).interpret('Build one park',{})
    assert asyncio.run(run())==intent
    assert len(bodies)==1

def test_provider_grammar_derives_fields_and_requires_complete_objects():
    schema=gemini_intent_schema()
    assert set(schema['properties'])==set(ArchitectIntent.model_fields)
    assert schema['required']==list(ArchitectIntent.model_fields)
    builds=schema['properties']['builds']['items']
    assert builds['required']==['buildingType','quantity','preferredPosition']
    assert builds['properties']['buildingType']['enum']==ArchitectIntent.model_json_schema()['$defs']['BuildRequest']['properties']['buildingType']['enum']
    encoded=json.dumps(schema)
    for keyword in ('$ref','$defs','default','maxLength','minLength','maximum','maxItems'):
        assert f'"{keyword}"' not in encoded

@pytest.mark.parametrize('patch',[
    {'builds':[{'buildingType':'villa','quantity':33,'preferredPosition':None}]},
    {'summary':'x'*513},
    {'region':{'x':0,'y':0,'width':0,'height':10}},
    {'untrustedExtraField':'not allowed'},
])
def test_simplified_provider_grammar_does_not_weaken_backend_validation(monkeypatch,patch):
    payload=ArchitectIntent(summary='One park',language='en',builds=[{'buildingType':'park','quantity':1}]).model_dump()
    provider,generate,_,_,_=setup(monkeypatch,text=json.dumps({**payload,**patch}))
    with pytest.raises(ArchitectError) as failure:
        asyncio.run(provider.interpret('Build one park',{}))
    assert failure.value.code=='PROVIDER_INVALID_RESPONSE'
    assert generate.await_count==1
