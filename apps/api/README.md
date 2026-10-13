# TINY CITY API — Planning and Accounts

FastAPI provides Gemini intent interpretation and a bounded bridge to the authoritative TypeScript city planner. It does not store or mutate the client's live world.

The same API also owns TINY CITY accounts, email verification, opaque server-side sessions, profile/security settings, and owner-scoped cloud city snapshots. The simulation package remains authoritative; a cloud snapshot is validated again by the TypeScript loader before it enters gameplay.

From the repository root, run `npm ci` and `npm run build:architect`; then from this directory run `uv sync --locked --extra dev`, copy `.env.example` to `.env` only if `.env` does not already exist, and run `uv run alembic upgrade head` before `uv run uvicorn tiny_city_api.main:app --host 127.0.0.1 --port 8787`.

Configuration is backend-only: `.env.example` documents defaults and Settings loads `.env` without overriding shell environment variables. Put your key in `GEMINI_API_KEY` in this ignored file. Existing files/keys must be preserved. Without a key `/v1/city/plan` reports `PROVIDER_NOT_CONFIGURED`; `/v1/city/plan/validate` works offline. `TINY_CITY_PROVIDER_MODE=mock` explicitly enables a fixed demo fixture.

## Local email and database setup

Account email delivery is deliberately disabled by default. To test verification and reset locally, explicitly set `AUTH_EMAIL_BACKEND=dev_sink` and `DEV_EMAIL_SINK_ENABLED=true` in `apps/api/.env`, then restart the API. The local-only inbox is `GET http://localhost:8787/v1/dev/mailbox` (or `/api/v1/dev/mailbox` through Vite); it contains one-time links and must never be enabled or exposed in production. For actual delivery, configure `AUTH_EMAIL_BACKEND=smtp`, `SMTP_HOST`, `SMTP_PORT`, optional `SMTP_USERNAME`/`SMTP_PASSWORD`, and `SMTP_FROM_EMAIL`. If email is not configured, account email actions return an explicit service error and do not claim that mail was sent.

Local SQLite is for one development instance. Account tables are created only through Alembic; application startup never calls `create_all()`. Migrations can be re-run safely with `uv run alembic upgrade head`. Before production, use a shared PostgreSQL database, for example `DATABASE_URL=postgresql+psycopg://...`, set `APP_ENV=production`, `SESSION_COOKIE_SECURE=true`, `FRONTEND_BASE_URL=https://...`, and `TINY_CITY_CORS_ORIGINS` to the exact HTTPS frontend origins. Choose `SESSION_COOKIE_SAMESITE=none` only when frontend and API are truly cross-site; it requires Secure cookies and HTTPS. Configure trusted proxy IP handling at the deployment boundary. Run migrations as a release step, never against production from a developer laptop without the deployment process.

The session cookie is opaque, HttpOnly, Secure in production, and checked against a revocable server-side session row. Unsafe account requests require an exact configured Origin and a double-submit CSRF cookie/header tied to the session hash. Login, registration, email/token actions use atomic rate buckets in the shared database. Logs contain request ID, status, and duration only—never credentials or token values. CORS uses an explicit origin list with credentials enabled; wildcard origins are rejected.

### Account routes

- `GET /v1/auth/csrf`; `POST /v1/auth/register`, `/verify-email`, `/resend-verification`, `/login`, `/logout`, `/forgot-password`, `/reset-password`; `GET /v1/auth/me` (401 without a session); `GET /v1/auth/session` (always 200: `{authenticated, user}`, used by the app's start-up check so guests never trigger a failed request).
- `GET/PUT/DELETE /v1/users/me`; `POST /v1/users/me/password`; `GET/DELETE /v1/users/me/sessions` and `DELETE /v1/users/me/sessions/{session_id}`.
- `GET/POST /v1/users/me/cities`; `GET/PUT/DELETE /v1/users/me/cities/{save_id}`.

Cloud saves require a verified account, use the authenticated session as owner, enforce a payload limit and schema version, and use an expected revision for updates. The API never accepts a client `user_id` for authorization. Browser-only saves remain available to guests. The account UI shows local and cloud copies separately and asks before upload, update, load, or delete.

Endpoints: `/health`, `/v1/city/status` (provider mode, whether a key is configured, planner built — never calls the provider or reveals credentials), `/v1/city/catalog`, `/v1/city/plan`, `/v1/city/plan/validate`, `/docs`, `/openapi.json`. There is no apply endpoint: approval and atomic execution belong to the shared client helper and existing engine.

Tests: `uv run --locked --extra dev python -m pytest -q -W error`. Account tests use an isolated SQLite database and in-memory mail adapter; no real email or Gemini calls are made. SDK responses are mocked; API tests still run the real TypeScript planner. A separate potentially paid live check is `uv run python -m tiny_city_api.live_smoke`.

See [contracts](../../docs/ai-architect/phase-2a-contracts.md), [Developer B integration](../../docs/ai-architect/phase-2a-integration.md), and [acceptance](../../docs/ai-architect/phase-2a-acceptance.md).
