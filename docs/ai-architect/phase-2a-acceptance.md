# Phase 2A acceptance

Starting baseline: `1a9eac6f362cf956d995ee8156f48012d94b095c` (merged Phase 1 acceptance), fetched before creating `feature/p2-ai-engine`.

## Architecture and delivered behavior

FastAPI's official Google Gen AI adapter interprets Vietnamese/English prompts into strict Pydantic intent. A fixed, bounded, JSON-only Node subprocess executes `@tiny-city/ai-architect`; that package imports the existing Phase 1 simulation for every authoritative rule and atomic command validation. Python never maintains building prices, footprints, occupancy or a second live world.

The deterministic planner supports all nine building types, multiple buildings, requested moves, explicitly authorized demolitions/road removals, budgets, protected buildings, region boundaries and compact/coastal/near preferences. It selects legal lots, relocates recoverable invalid preferences with warnings, adds shortest free road links, joins disconnected proposed road components, and reorders roads before required construction. It accepts partial quantities only with explicit opt-in. Impossible exact requests yield a rejected proposal with no commands. Spatial preferences guide placement; region/footprint/occupancy/budget constraints are hard rules. No placement randomness is taken from wall time or Math.random.

Proposals expose typed geometry, road edits, source revision/fingerprint, deterministic IDs/digests, costs, projected funds, warnings and engine CityCommand batches. Public endpoints are `/v1/city/plan`, `/v1/city/plan/validate` and `/v1/city/catalog`. Existing `/health` remains compatible. No apply endpoint pretends the backend owns a client world.

The shared `PlanReview` follows validated → previewed → explicitly approved → applied, or rejected. It detects tampering, stale revisions and city fingerprint changes; rechecks the complete plan and simulation rules; requires additional consent for destructive edits; prevents duplicate/concurrent application; checks again immediately before atomic execution. Time progression is compatible, while changed citizen references can still invalidate a demolition. Rejection/preview never mutates the world. Integration wraps the existing commit/history/projection flow.

## Safeguards

Backend-only SecretStr credentials; ignored local `.env`; strict request/provider schemas; bounded HTTP bodies, prompt/context/output sizes, map/candidate/operation limits, concurrency and request rate; one default transient retry; SDK retries disabled; timeouts and request cancellation; killed timed-out Node workers; credential-free worker environment; no shell expansion, arbitrary script execution, tools, model-to-code execution or filesystem access in AI output; sanitized error envelopes and request-ID/status/duration logging. CI uses fake SDK/provider responses and the real deterministic engine.

No frontend interface, renderer, Phase 1 engine, existing prices or save schema was rewritten. No Gemini credentials are bundled or tracked. The exported contracts and generated examples are documented for Developer B before UI reliance.

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Clean root npm install and locked uv environment | PASS | npm ci; uv sync --locked --extra dev; Node 24.16, npm 11.13, Python 3.12.14, uv 0.12.21 |
| Official maintained provider SDK/configuration | PASS | google-genai 2.29.0, pydantic-settings 2.15.0; schema/config/retry tests |
| Backend startup and real HTTP mock planning | PASS | Uvicorn loopback smoke: health, catalog, /plan, /plan/validate, OpenAPI |
| API/provider integration, failure/cancellation/security behavior | PASS | 57 pytest tests, warnings treated as errors; real Node subprocesses and SDK HTTP serialization |
| Planner/review lifecycle | PASS | 27 tests, all nine types, 21-building district, repairs, budgets, approval, replay, stale worlds and citizen safety |
| Phase 1 simulation regression | PASS | 155 Vitest tests |
| Frontend regression and TypeScript checks | PASS | 55 frontend tests; root and planner typecheck |
| Production build and gameplay regression | PASS | Vite build; 16 existing production-browser tests |
| Secret/history/configuration scan | PASS | No credential signatures in worktree/reachable Git blobs; no Gemini settings in frontend; .env ignored |
| Developer B contract/examples | PASS | JSON examples validated by FastAPI and imported/applied by TS review tests; exported OpenAPI |
| Real paid Gemini smoke | PASS | Vietnamese and English live HTTP requests with gemini-3.5-flash-lite; both proposals approved/applied through the real simulation |

## Real Gemini verification — 2026-10-11

The key was securely loaded from the user's ignored `apps/api/.env`; it was not present in the Node subprocess environment, printed, modified or tracked. Authenticated model metadata confirmed `gemini-3.5-flash-lite` was available. FastAPI started on `127.0.0.1:8010` in Gemini mode.

The initial bilingual requests failed with HTTP 502 `PROVIDER_INVALID_RESPONSE`. Google's underlying HTTP 400 rejected the SDK's legacy `response_schema` serialization of `additional_properties`. Passing the complete raw Pydantic JSON Schema also returned `INVALID_ARGUMENT`. The fix derives a smaller, complete-object JSON grammar from the existing Pydantic model and sends it via `response_json_schema`. References are inlined and provider-only bounds/defaults are omitted; strict Pydantic limits, forbidden extra fields and all deterministic simulation checks remain authoritative. Offline tests now exercise the real SDK HTTP serialization rather than mocking past that boundary.

Live interpretation initially grouped separately positioned villas under one preferred coordinate. The instruction now requires separate building requests for distinct positions, and both final responses preserved the two requested coordinates.

The final check ran from `apps/api` as `.venv/bin/python -m tiny_city_api.live_smoke --base-url http://127.0.0.1:8010` (equivalently `uv run python -m tiny_city_api.live_smoke --base-url http://127.0.0.1:8010`), with the backend already running. It executed two real, potentially paid Gemini requests and two offline budget-rejection requests. No mock provider was used. The sanitized machine-readable record is [live-acceptance-results.json](examples/live-acceptance-results.json).

| Prompt | HTTP | Latency | New buildings | New road tiles | CityCommands | Cost | Funds before → after |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Vietnamese: exactly 2 villas + 1 park, requested coordinates, connect roads, budget 500, preserve existing city | 200 PASS | 2,380 ms | 3 | 12 | 5 | 416 | 4,880 → 4,464 |
| English: the equivalent request | 200 PASS | 2,405 ms | 3 | 12 | 5 | 416 | 4,880 → 4,464 |

Both returned strict structured intents, correct quantities and distinct villa preferences. The 5 commands comprise 3 builds and 2 road-edit batches. Authoritative catalog costs are 2 ×120 +80 +12 ×8 =416; all road-requiring buildings joined one connected road graph. The park was relocated to avoid the new road and reported `RELOCATED` rather than hiding the repair.

Each check used an isolated fixture with an existing villa and road network. Preview and approval preserved the entire serialized world, including clock/RNG/revision/budget. Applying before approval failed. Exact-ID approval followed by application committed the whole proposal, emitted 3 building events and matched the projected CityPlan and budget. An invalid final command rolled back the entire batch. A reduced budget of 100 returned a rejected proposal with no executable commands. Stale-world preview and duplicate application were blocked, and existing buildings/roads were preserved. These checks did not mutate a user's open game or saves.

Live acceptance is now verified for these two bounded prompts and this configured key/model. CI remains entirely mocked; this is not a claim of exhaustive model-language quality or guaranteed future provider availability.

## Known limits and handoff

- Only 32 requested buildings, 128 tile/edit operations, 4,096 map tiles, and 4,096 candidate scans per proposal; sufficiently complex/blocked regions can return bounded-search or timeout warnings/errors rather than guarantee an optimal packing.
- Style and proximity are preferences, not an aesthetic renderer or an urban zoning system. Road links may attach to any existing component; the planner preserves disconnected legacy components unless explicitly editing them. It does not simulate traffic or NPC pathfinding.
- Model inference is not promised bitwise deterministic. Identical normalized intent, snapshot, constraints and seed yield the same deterministic proposal. Model ambiguity/unsupported types are never silently treated as a different request.
- The backend is stateless and local. Limits and review replay registries are process/session-local; no database, account authentication, cross-device replay ledger, durable billing quota or world storage is introduced.
- Live SDK/model availability, authentication and both acceptance prompts passed with the configured backend key on 2026-10-11. Arbitrary-language semantics, complex prompt quality, quota exhaustion and future model availability are not exhaustively verified. No live test is mandatory in CI; the paid smoke remains an explicit command.
- The existing ~570 kB frontend bundle advisory remains; Phase 2A did not change the frontend bundle.

Developer B: follow [integration](phase-2a-integration.md), import the shared contracts, send canonical world/revision, render an immutable overlay, wire Preview/Approve/Reject to PlanReview on a stable adapter for the existing authoritative commit function, and use existing history/save/events after successful application. Handle stale/error/partial results explicitly. No automatic approval is permitted.

PHASE 2A ACCEPTED
