# Phase 3A acceptance evidence

Starting main: `7ec421f67ca5df79204315c8b0a30cc08664fc1e`. All refs were fetched before creating `feature/p3-npc-simulation`; main's [City acceptance run 38143918058](https://github.com/NguyenTienThanh2007/tiny-city/actions/runs/38143918058) passed. A final fetch found the same main. No unrelated repairs, dependency changes, credentials, NPC visuals or Phase 4 work are included.

## Implemented foundation

- Managed population explicitly extends schema 2. Existing saves/Phase 0–2 callers retain legacy behavior; `enablePopulation()` or `createWorld` population options activate living-world logic. Managed saves load through the existing frontend envelope.
- Monotonic IDs, seeded names/adult attributes, home/job reservation, capacity limits, deterministic filling of housing, employment growth, and safe reassignment/removal on demolition.
- Varied daily routines on the existing fixed clock, custom schedule validation, progressive travel, arrival/activity events, pause/resume, accelerated time and bounded waiting/retry behavior.
- Existing occupancy and road graph power deterministic multi-source BFS. Routes use road centers and legal footprint entrance legs, never vacant terrain/foreign buildings. Per-plan indexes and cached road paths avoid BFS every frame.
- Authoritative city edits reconcile population using the same reducer for preview and commit. Failed AI/city batches preserve citizens, RNG, IDs, funds and revisions. NPC-only ticks preserve Phase 2 proposal approval semantics.
- Managed city history restores identities without rewinding time/RNG/high-water marks. Same surviving residents retain live positions/activity before route invalidation; undo of removed residents reconstructs safe home interiors. History emits creation/removal events. In-flight and deferred travel resume deterministically after save/load.
- Indexed selection by ID, building resident/worker/visitor queries, immutable movement/heading snapshots, typed events, living-world fixtures and an opt-in method on the existing React hook provide the Phase 3B handoff.

Review also caught and fixed a leisure-snapshot restoration rejection and missing identity events during undo/redo. Both have regression tests. Two simulated days of mixed road edits, building moves, history restoration and repeated save/load remain valid.

## Verification

Local verification on 2026-10-11, Node 24.16.0, Python 3.12.14, macOS arm64:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass; strict simulation, architect, frontend and E2E TypeScript |
| `npm run test:simulation` | 212 passed, including 57 new NPC cases |
| `npm run test:architect` | 31 passed, including managed preview/approval and occupied demolition |
| `npm test` | 73 passed, including managed frontend save/load |
| API `.venv/bin/python -m pytest -q -W error` | 58 passed; real TS planner with mocked provider and managed fixture |
| `npm run test:e2e` | 23 passed; production Vite/Pixi plus FastAPI, including managed editing/history/persistence |
| `npm run build` | Pass |
| `npm run security` | Zero findings in tracked files/history; credential values never printed |
| `git diff --check` | Pass |

Total: **397 tests**, including the existing Phase 1/2 suite. The existing CI runs these same suites. Playwright explicitly overrides provider mode to mock and the API key to empty. No live Gemini or paid calls were executed for this phase. The API environment was already installed; its venv interpreter was used locally because the sandbox cannot write the default uv cache. Production E2E successfully starts the locked API through uv.

Browser coverage includes all nine building types (preview, selection, construction, move, demolition, history, persistence), roads/drag, camera/minimap, zoom/pan, high DPI, keyboard refresh, mobile access, invalid placement feedback, bilingual AI preview/rejection/approval, stale/cancelled plans and save/reload. The managed fixture is loaded into the production UI, edited through real pointer events, undone, saved and reloaded with valid citizens and no browser runtime errors. After the final history fixes, the affected managed browser case is repeated against a fresh build.

## Measured performance

Run `npm run bench:npc`. Raw measurements are in [benchmark-results.json](benchmark-results.json). These are headless engine timings, with 200 fixed ticks per population on Node 24.16.0/macOS arm64. Initialization includes fixture creation/validation and runner construction. The first tick additionally applies one queued custom schedule per resident; the following measurements cover normal navigation updates. Validation after measurement is excluded from timed ticks.

| NPCs | Initialization ms | First tick ms | Mean tick ms | p95 tick ms | Max tick ms | BFS searches / cache hits |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 8.856 | 9.822 | 0.169 | 0.426 | 2.738 | 6 / 94 |
| 1,000 | 21.043 | 32.342 | 0.964 | 1.429 | 3.571 | 50 / 950 |
| 3,000 | 70.008 | 248.061 | 3.185 | 5.023 | 10.623 | 150 / 2,850 |

The representative 100-NPC engine workload remains well below the default 100 ms tick interval on this machine. This is not a rendering FPS measurement. The 3,000-command first-tick burst exceeds that interval; larger populations need batching/profiling before increasing product defaults. Results vary by map, runtime and device.

## Contracts and changed files

Developer B should review [public NPC contracts](phase-3a-contracts.md) and [typed integration examples](phase-3a-integration.md) before relying on shared fields. These document IDs, names, positions, activities, references, destinations, headings, population, clock, single-ticker integration, selection, events and persistence. Activate the existing hook once; use the authoritative snapshot and stable citizen IDs for rendering/selection. Interior occupants can be hidden using `movement.currentBuildingId`.

- `packages/simulation/src/{types,world,simulation,cityCommands,fixtures,index}.ts`: public optional contracts, validation, history/commands and exports.
- `packages/simulation/src/{population,life,navigation}.ts`: population, decisions and routing.
- `packages/simulation/tests/{npc,npcFixture}.ts`, `packages/ai-architect/tests/planner.test.ts`, `apps/api/tests/test_architect.py`: engine and planning regressions.
- `src/simulation/{citySave,citySave.test,useCitySimulation}.ts`, `e2e/npc-persistence.spec.ts`: save compatibility, opt-in hook and production browser regression.
- `scripts/npc_benchmark.mjs`, root `package.json`, `docs/npc/`, `docs/simulation/contracts.md`, root/package README: benchmark and integration/acceptance documentation.

## Limits and Phase 3B work

- Existing frontend worlds remain legacy until Developer B invokes population activation. NPC sprites, animation, hit-testing and interaction UI are Phase 3B responsibilities.
- All generated residents are adults and housing fills immediately; there are no births/deaths, traffic collisions, personality LLM calls or recurring economy.
- Route work is limited to 16 requests/tick, 4096 nodes/search and 256 cache entries. Default population cap is 1000; hard cap is 10000. These are deterministic safeguards, not a performance promise at the hard cap.
- Structural edits conservatively invalidate routes. Unreachable residents wait until a city revision or routine change; deleting a road underfoot keeps the resident stationary until legal access is restored. Editor relocation/demolition can reanchor interior residents immediately; ordinary travel is progressive.
- Long clock jumps select the resulting routine. Managed ticks allow at most one game day to bound midnight events. Pending commands are runner-only and must be drained/journaled before saving.
- Existing API map/context and 1 MB request safeguards remain; very large route-heavy snapshots may receive `REQUEST_TOO_LARGE` before provider work.
- The frontend's existing Vite chunk-size advisory remains (main bundle 622.84 kB); it does not fail the build.

No critical simulation/data-integrity blocker remains in the verified workload. The feature is ready for review and Phase 3B integration. The PR must remain unmerged for human review.

**PHASE 3A ACCEPTED**
