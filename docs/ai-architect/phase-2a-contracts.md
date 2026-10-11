# Phase 2A public contract (version 1)

The backend interprets prompts but does not own, mutate or persist city state. TypeScript `@tiny-city/ai-architect` imports Phase 1 simulation contracts and implements placement, validation, repair and approval. Costs, footprints, occupancy and road rules are read from `@tiny-city/simulation`; Python contains no alternate rules engine.

- `POST /v1/city/plan`: `{contractVersion:1,prompt,world,sourceRevision,seed?,constraints?}` → `{requestId,proposal}`. Missing Gemini credentials produce `PROVIDER_NOT_CONFIGURED`; there is no implicit fake fallback.
- `POST /v1/city/plan/validate`: `{contractVersion:1,world,sourceRevision,seed?,constraints?,intent}` → `{requestId,proposal}`. This offline deterministic endpoint validates/repairs structured intent without a paid call.
- `GET /v1/city/catalog`: authoritative catalog and operation limits for consumers.
- `/health` remains compatible. OpenAPI is at `/docs` and `/openapi.json`.

`ArchitectIntent` contains summary, language (`en|vi`), style, near preference, optional region and budget limit, building requests with quantities and optional preferred positions, moves, demolition IDs, road edits, preservation IDs, connectivity preference, and unsupported/ambiguous request descriptions. Model output is strict and untrusted. The model cannot authorize partial or destructive edits.

`PlanningConstraints` contains `allowPartial` (default false), `allowDestructive` (default false), explicit `allowedDemolitions` and `allowedRoadRemovals`, `preserveBuildingIds`, `budgetLimit`, and `maxOperations` (1–128). Preservation always wins. A rejected exact request has no executable commands; partial quantities require caller opt-in and produce warnings.

`PlanProposal` contains contract version, deterministic plan ID/digest, source world ID/revision/fingerprint, seed, intent/constraints, summary/explanation, status (`VALIDATED|REJECTED` from API), the authoritative projected `CityPlan`, building placement details (ID/type/position/footprint), road additions/removals, estimated cost, projected budget, validation result, warnings, and authoritative `CityCommand[]`. API request IDs are separate from deterministic plan IDs.

Lifecycle: internal DRAFT → VALIDATED → PREVIEWED → APPROVED → APPLIED, or REJECTED. `PlanReview` must preview before approval, accepts only approval for the exact plan ID, and applies using `Simulation.executeBatch`. It checks proposal integrity, source city fingerprint, revision, all commands, costs and projected geometry again. Revision/fingerprint checks are repeated after async work immediately before synchronous atomic execution. Failed or rejected applications do not mutate city, clock, RNG, IDs or budget. Registry state prevents duplicate application in one simulation instance, including after undo. Restored worlds invalidate old proposals through revision/fingerprint; application history is not a backend database or cross-device replay ledger.

Fingerprint binds world ID, city plan, budget, ID cursor and revision; clock progression does not invalidate unchanged city plans. Citizen safety remains enforced by the final simulation batch validation. Digests protect consistency, not provider authenticity; consumer-side command validation and explicit approval are mandatory.

Limits: 4,000 prompt characters, 1 MiB HTTP body, 4,096 map tiles, 32 requested buildings, 128 commands, bounded candidate scans and road search. Road links use orthogonal free tiles and may connect to any existing road component. Existing roads are never removed by repair. New isolated districts receive a seed road with an explicit warning when the map has no road network.

Error envelope: `{requestId,error:{code,message,retryable}}`. Codes: `INVALID_REQUEST`, `INVALID_WORLD`, `STALE_WORLD`, `CONTEXT_LIMIT`, `PLAN_REJECTED`, `PROVIDER_NOT_CONFIGURED`, `PROVIDER_INVALID_RESPONSE`, `PROVIDER_TIMEOUT`, `PROVIDER_RATE_LIMIT`, `PROVIDER_AUTH`, `PROVIDER_UNAVAILABLE`, `PLANNER_UNAVAILABLE`, `PLANNER_TIMEOUT`, `SERVER_BUSY`, `REQUEST_TOO_LARGE`, `REQUEST_CANCELLED`. Client helper also reports `APPROVAL_REQUIRED`, `ALREADY_APPLIED`, `PLAN_REJECTED`, `INVALID_PROPOSAL`, `DESTRUCTIVE_APPROVAL_REQUIRED`. Error messages never echo provider exception strings, prompts or credentials.

Canonical TypeScript definitions are in `packages/ai-architect/src/contracts.ts`; Pydantic wire models are in `apps/api/tiny_city_api/architect_models.py`. Cross-language tests load backend-generated proposal examples and validate/apply them using the real engine. World snapshots retain schema version 2; Phase 1 prices, saves and existing commands are unchanged.
