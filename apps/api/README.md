# TINY CITY API — Phase 0

Minimal FastAPI app factory with a typed health endpoint, generated OpenAPI docs, configurable development CORS, and smoke tests. The TypeScript package owns simulation data and execution. This scaffold has no Gemini SDK, credentials, AI calls, persistence, or simulation endpoints.

## Run

Requires Python 3.11+ and uv. From `apps/api`:

```sh
uv sync --locked --extra dev
uv run --locked uvicorn tiny_city_api.main:app --reload --host 127.0.0.1 --port 8000
```

- `GET /health` returns `{"status":"ok","service":"tiny-city-api","phase":0}`.
- `/docs` provides the interactive OpenAPI UI; `/openapi.json` exposes the schema.

## Configure

Set `TINY_CITY_CORS_ORIGINS` to a comma-separated list of exact frontend origins. Defaults are `http://localhost:5173` and `http://127.0.0.1:5173`. An empty value disables cross-origin access. Only GET is enabled for cross-origin requests, and credentials are disabled.

```sh
export TINY_CITY_CORS_ORIGINS=http://localhost:3000
uv run --locked uvicorn tiny_city_api.main:app --reload --host 127.0.0.1 --port 8000
```

`.env.example` documents the variable; `.env` is not automatically loaded. Tests can inject origins through `create_app(cors_origins=[...])` without changing global environment state.

## Verify

```sh
uv run --locked --extra dev python -m pytest -q
```

The committed `uv.lock` pins dependencies. Do not duplicate TypeScript world contracts as Python request models until Developer A and Developer B agree on a transport contract.

The test extra uses `httpx2`, the client supported by the current [Starlette TestClient](https://starlette.dev/testclient/).
