"""AI Architect 2.0 reliability: every /v1 failure follows the error contract, and offline interpretation works."""
import json
from pathlib import Path
from fastapi.testclient import TestClient
from tiny_city_api.config import Settings
from tiny_city_api.main import create_app

EXAMPLES = Path(__file__).resolve().parents[3] / 'docs/ai-architect/examples'


def settings(**kwargs):
    return Settings(_env_file=None, gemini_api_key='', **kwargs)


def contract(response, status, code):
    assert response.status_code == status
    body = response.json()
    assert set(body) == {'requestId', 'error'} and body['requestId'] == response.headers['x-request-id']
    assert body['error']['code'] == code and isinstance(body['error']['message'], str) and isinstance(body['error']['retryable'], bool)
    return body


def test_unknown_routes_and_methods_use_the_error_contract_instead_of_bare_detail() -> None:
    with TestClient(create_app(settings=settings(tiny_city_provider_mode='mock'))) as client:
        contract(client.get('/v1/city/does-not-exist'), 404, 'NOT_FOUND')
        contract(client.get('/v1/city/plan'), 405, 'METHOD_NOT_ALLOWED')
        contract(client.post('/v1/city/plan', content=b'{not json', headers={'Content-Type': 'application/json'}), 422, 'INVALID_REQUEST')
        # Non-API paths keep FastAPI's default shape.
        assert client.get('/nope').json() == {'detail': 'Not Found'}


def test_unexpected_server_errors_become_retryable_contract_errors_without_internals() -> None:
    class Broken:
        async def call(self, *args, **kwargs):
            raise RuntimeError('secret internal detail')
    app = create_app(settings=settings(tiny_city_provider_mode='mock'), bridge=Broken())
    with TestClient(app, raise_server_exceptions=False) as client:
        request = json.loads((EXAMPLES / 'plan-request.json').read_text())
        body = contract(client.post('/v1/city/plan', json=request), 500, 'INTERNAL_ERROR')
        assert body['error']['retryable'] is True and 'secret internal detail' not in json.dumps(body)


def test_status_identifies_the_service_and_local_mode() -> None:
    with TestClient(create_app(settings=settings(tiny_city_provider_mode='local'))) as client:
        body = client.get('/v1/city/status').json()
        assert body['service'] == 'tiny-city-api' and body['provider'] == {'mode': 'local', 'configured': True, 'model': None}


def test_local_rules_interpret_vietnamese_without_any_ai_call() -> None:
    request = json.loads((EXAMPLES / 'plan-request.json').read_text())
    request['prompt'] = 'Xây 2 biệt thự gần đường'
    with TestClient(create_app(settings=settings(tiny_city_provider_mode='local'))) as client:
        response = client.post('/v1/city/plan', json=request)
        assert response.status_code == 200
        proposal = response.json()['proposal']
        assert proposal['intent']['language'] == 'vi' and proposal['intent']['builds'] == [{'buildingType': 'villa', 'quantity': 2, 'preferredPosition': None, 'design': None}]
        assert proposal['status'] == 'VALIDATED' and len(proposal['placements']) == 2
        assert proposal['summary'].startswith('Trình diễn giải ngoại tuyến')
        assert proposal['impact']['buildingsAdded'] == 2 and proposal['clarifications'] == [] and proposal['authorization'] is None


def test_legacy_intents_without_target_fields_still_validate() -> None:
    request = json.loads((EXAMPLES / 'validate-request.json').read_text())
    assert 'demolishTargets' not in request['intent']
    with TestClient(create_app(settings=settings(tiny_city_provider_mode='mock'))) as client:
        response = client.post('/v1/city/plan/validate', json=request)
        assert response.status_code == 200 and response.json()['proposal']['status'] == 'VALIDATED'
