# TINY CITY API — Phase 2A

FastAPI provides Gemini intent interpretation and a bounded bridge to the authoritative TypeScript city planner. It does not store or mutate the client's live world.

From the repository root, run `npm ci` and `npm run build:architect`; then from this directory run `uv sync --locked --extra dev` and `uv run uvicorn tiny_city_api.main:app --host 127.0.0.1 --port 8000`.

Configuration is backend-only: `.env.example` documents defaults and Settings loads `.env` without overriding shell environment variables. Put your key in `GEMINI_API_KEY` in this ignored file. Existing files/keys must be preserved. Without a key `/v1/city/plan` reports `PROVIDER_NOT_CONFIGURED`; `/v1/city/plan/validate` works offline. `TINY_CITY_PROVIDER_MODE=mock` explicitly enables a fixed demo fixture.

Endpoints: `/health`, `/v1/city/catalog`, `/v1/city/plan`, `/v1/city/plan/validate`, `/docs`, `/openapi.json`. There is no apply endpoint: approval and atomic execution belong to the shared client helper and existing engine.

Tests: `uv run --locked --extra dev python -m pytest -q -W error`. SDK responses are mocked; API tests still run the real TypeScript planner. A separate potentially paid live check is `uv run python -m tiny_city_api.live_smoke`.

See [contracts](../../docs/ai-architect/phase-2a-contracts.md), [Developer B integration](../../docs/ai-architect/phase-2a-integration.md), and [acceptance](../../docs/ai-architect/phase-2a-acceptance.md).
