# Developer B integration

Phase 2B owns prompt/history/loading UI, preview overlays, approval buttons, animations and user-facing warnings. Phase 2A changes no game interface or Phase 1 simulation/save format.

## Local setup and startup

The repository uses root npm workspaces and `apps/api/uv.lock`. Setup has already installed the dependencies and created an ignored `apps/api/.env` from `.env.example`, with an empty key. Existing configuration files and credentials are never overwritten. Enter `GEMINI_API_KEY` in that backend file to enable live interpretation; never put it in browser code, a `VITE_` variable, Git or chat.

```sh
# Repository root
npm ci
npm run build:architect
# Backend
cd apps/api
uv sync --locked --extra dev
uv run uvicorn tiny_city_api.main:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/docs`. Development CORS permits localhost/127.0.0.1:5173 and POST; set `TINY_CITY_CORS_ORIGINS` for another explicit local frontend origin. The service is intended for local use. Public deployment needs authentication and a durable quota/replay policy at the service boundary; process-local limits do not provide account authentication or persistent billing quotas.

For a manual offline backend demo, start with `TINY_CITY_PROVIDER_MODE=mock`. That mode is explicit, returns the documented fixed fixture, and labels its summary as an offline fixture; it does not interpret arbitrary prompts or masquerade as Gemini. `/plan/validate` always works offline with structured intent. Tests inject fake providers and never need real credentials.

Google Gen AI SDK 2.29.0 is locked in uv. The configured default is `gemini-3.5-flash-lite`; model selection, timeout, bounded retries, output tokens, context characters, process timeout, rate and concurrency limits are in `.env.example`. Environment variables take precedence over `.env`. SDK internal retries are disabled so the adapter's default one retry is the entire retry budget. Transient 429/5xx/network timeouts are retried with bounded backoff; bad requests/auth/schema responses are not retried. No tool use, code execution, grounding, filesystem access or provider command execution is enabled. See Google's [model list](https://ai.google.dev/gemini-api/docs/models), [structured output documentation](https://ai.google.dev/gemini-api/docs/structured-output), and [official SDK](https://googleapis.github.io/python-genai/).

## Request and preview

Import `PlanningRequest`, `PlanningResponse`, `ArchitectErrorResponse`, `PlanReview`, and `PlanningHost` from `@tiny-city/ai-architect`. Send the current canonical `WorldState` from the existing simulation, its exact `revision`, the prompt, optional seed, and constraints to `/v1/city/plan`.

```ts
const request: PlanningRequest = {
  contractVersion: 1, prompt, world: getSnapshot(),
  sourceRevision: getSnapshot().revision, seed: 7,
  constraints: { allowPartial: false, allowDestructive: false },
};
const response = await fetch('http://127.0.0.1:8000/v1/city/plan', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(request), signal: abortController.signal,
});
// Handle non-2xx ArchitectErrorResponse before reading PlanningResponse.
const { proposal } = await response.json() as PlanningResponse;
```

Render proposal placements/footprints and road additions/removals in a temporary overlay. Never write proposals directly into CityState or the live plan. A `REJECTED` response has no executable commands. Show warnings and distinguish `validation.fulfilled=false` from full fulfillment. Render summaries/explanations as text, not HTML.

`examples/plan-request.json`, `validate-request.json`, `mock-plan-response.json`, and `error-response.json` are generated, runnable fixtures. The mock response has a valid digest and passes the real client review/application tests against the included world. Use the fixture only with its source world; using it in another city correctly yields `STALE_WORLD`.

## Approval and application

Create one stable host adapter for the existing live simulation/Phase 1 commit boundary; do not instantiate a second live Simulation. `getState` returns `getSnapshot()`. `executeBatch` must synchronously call the existing authoritative commit function and preserve its history, city projection, dirty-save state and typed events. The adapter object must stay stable across React renders for review/replay state.

```ts
const host: PlanningHost = {
  getState: getSnapshot,
  executeBatch: commitCommands, // existing atomic engine + Phase 1 history/projection path
};
const review = new PlanReview(host, proposal);
const preview = await review.preview(); // integrity + current-world validation, zero mutation
// Render preview. Wait for the user's explicit approval button.
review.approve(preview.planId); // exact ID; no automatic approval
const result = await review.apply(); // all commands or none, authoritative events/state
// Rejection button: review.reject(); clear overlay, without changing the city.
```

For intentional demolition/removal, the original request must set `allowDestructive=true` and list exact allowed building IDs/road tiles; preservation constraints still win. The approval button must call `approve(planId, { allowDestructive: true })` after displaying those destructive edits. Moving is a separate existing command; footprint/road rules are revalidated and identity stays stable.

On `STALE_WORLD`, discard the overlay and request a fresh plan. Do not patch the source revision or recompute the digest to reuse a stale proposal. Time advancement alone does not stale the city fingerprint, but citizen-reference safety is checked again. Concurrent/duplicate apply attempts cannot execute the same plan twice. A cancelled or rejected review cannot apply. Restored worlds are protected by revision/fingerprint; review history is session state and is not serialized into Phase 1 saves.

The backend intentionally has no `/apply` endpoint. It cannot safely promise ownership or persistence of a client world. Save the returned real engine state through the existing save flow, and let existing typed events drive animations. Queued commands should be drained/journaled before snapshotting; Phase 1's immediate command flow already meets this requirement.

## Error handling and deadlines

Read `{requestId,error:{code,message,retryable}}` for HTTP errors. Propagate the request ID for diagnostics; do not log prompts, snapshots, provider exceptions or credentials. Missing keys produce 503 `PROVIDER_NOT_CONFIGURED`; stale snapshots produce 409 `STALE_WORLD`; malformed inputs produce 422 `INVALID_REQUEST`/`INVALID_WORLD`; resource limits produce 413/422/429/503. A well-formed but impossible intent produces HTTP 200 with `status=REJECTED`, warnings and no commands.

Do not automatically repeat the whole planning request after retries are exhausted; ask the user to retry so additional provider cost is deliberate. Default provider attempts are capped at two ×20 seconds plus 0.25 seconds backoff; each Node phase is capped at 15 seconds. Allow an approximately 75-second client deadline, with AbortController cancellation. ASGI disconnection/request cancellation cancels provider work and kills an in-flight planner subprocess. Increase deadlines only alongside bounded server settings.

For a separately labeled live check after supplying the key:

```sh
cd apps/api
uv run python -m tiny_city_api.live_smoke
```

This makes a real, potentially paid call only when a backend key exists. Ordinary CI never invokes it. Missing-key output is `NOT VERIFIED`, not a success.
