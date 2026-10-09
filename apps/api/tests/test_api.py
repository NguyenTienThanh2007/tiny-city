from fastapi.testclient import TestClient

from tiny_city_api.main import create_app


def test_health_and_openapi() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "service": "tiny-city-api", "phase": 0}
        schema = client.get("/openapi.json").json()
        assert "/health" in schema["paths"]
        assert schema["components"]["schemas"]["HealthResponse"]["properties"]["phase"]["const"] == 0


def test_cors_accepts_configured_origin_and_rejects_other_origins() -> None:
    with TestClient(create_app(cors_origins=["http://localhost:5173"])) as client:
        allowed = client.options("/health", headers={
            "Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"
        })
        assert allowed.status_code == 200
        assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
        denied = client.options("/health", headers={
            "Origin": "https://unconfigured.example", "Access-Control-Request-Method": "GET"
        })
        assert denied.status_code == 400
        assert "access-control-allow-origin" not in denied.headers


def test_cors_configuration_comes_from_environment(monkeypatch) -> None:
    monkeypatch.setenv("TINY_CITY_CORS_ORIGINS", " https://city.example, ")
    with TestClient(create_app()) as client:
        response = client.get("/health", headers={"Origin": "https://city.example"})
        assert response.headers["access-control-allow-origin"] == "https://city.example"
