from fastapi.testclient import TestClient

from tiny_city_api.config import Settings
from tiny_city_api.main import create_app


class ExplodingProvider:
    async def interpret(self, prompt, context):  # pragma: no cover - must never be called by status checks
        raise AssertionError('status must not call the AI provider')


def test_status_reports_mock_mode_without_provider_calls() -> None:
    with TestClient(create_app(settings=Settings(tiny_city_provider_mode='mock', gemini_api_key=''))) as client:
        response = client.get('/v1/city/status')
        assert response.status_code == 200
        body = response.json()
        assert body['status'] == 'ok'
        assert body['provider'] == {'mode': 'mock', 'configured': True}
        assert body['planner'] in ('ready', 'not-built')


def test_status_reports_missing_gemini_key_without_revealing_credentials() -> None:
    with TestClient(create_app(settings=Settings(tiny_city_provider_mode='gemini', gemini_api_key=''))) as client:
        assert client.get('/v1/city/status').json()['provider'] == {'mode': 'gemini', 'configured': False}
    secret = 'test-only-not-a-real-key'
    with TestClient(create_app(settings=Settings(tiny_city_provider_mode='gemini', gemini_api_key=secret))) as client:
        response = client.get('/v1/city/status')
        assert response.json()['provider'] == {'mode': 'gemini', 'configured': True}
        assert secret not in response.text


def test_status_never_invokes_a_custom_provider_and_honours_cors() -> None:
    app = create_app(cors_origins=['http://localhost:5173'], provider=ExplodingProvider())
    with TestClient(app) as client:
        response = client.get('/v1/city/status', headers={'Origin': 'http://localhost:5173'})
        assert response.json()['provider'] == {'mode': 'custom', 'configured': True}
        assert response.headers['access-control-allow-origin'] == 'http://localhost:5173'
        denied = client.get('/v1/city/status', headers={'Origin': 'http://192.168.1.20:5173'})
        assert 'access-control-allow-origin' not in denied.headers
