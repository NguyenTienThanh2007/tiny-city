# Acceptance — AI Architect 2.0 and Life Mode housing fix

Branch `feature/ai-architect-2`, created from `origin/main` @ `131f1df` (Phase 4 merged as #10).

## AI ARCHITECT 2.0 ACCEPTANCE

**Status: accepted.** Details are in [`docs/ai-architect/ai-architect-2.md`](../ai-architect/ai-architect-2.md).

### Root cause of the reported failure (reproduced against the live backends)

- `GET http://127.0.0.1:8000/v1/city/status` returned `404 {"detail":"Not Found"}`, and so did
  `POST http://127.0.0.1:8000/v1/city/plan`.
- Port 8000, the planner's default and the Vite proxy target, was held by an unrelated local FastAPI app, "F01 API".
- The client read the first 404 as an older TINY CITY API ("Planner online · readiness unknown"). It read the second
  as a malformed error ("The planning service returned an invalid error response.").
- The real TINY CITY API on a free port answered `/v1/city/status` with the service identity, Gemini configured and
  the planner ready. A live plan request returned `200 VALIDATED`.
- A latent server hang on fast-failing plan requests (the disconnect-monitor race) was found and fixed.

### Criteria

| Requirement | Result | Evidence |
| --- | --- | --- |
| Real API error contracts | Pass | `apps/api/tests/test_reliability.py` (unknown route/method, invalid JSON, unexpected error with request ID, no internals) |
| Readiness and wrong-service diagnosis | Pass | `src/aiArchitect/connection.test.ts` (the F01 case, older API, proxy errors); e2e "a different service on the planner port…" |
| Dev proxy and port conflicts | Pass | Port 8787 default, `npm run dev:api` (manually verified: names "F01 API" on 8000, detects a running planner on 8787), proxy tests |
| Vietnamese and English prompts | Pass | All 8 required prompts in `packages/ai-architect/tests/architect2.test.ts`; live Gemini check (below) |
| Building creation and multi-building plans | Pass | 10 villas + 2 apartments with connected roads; 8 villas + 2 parks clustered; exact quantities, no silent reduction |
| Exact and ambiguous demolition | Pass | Resolver tests; "Phá apartment đi" asks between two apartments; "bên trái" resolves the leftmost; ties ask |
| Destructive authorization and protected buildings | Pass | Authorization required with protection on or off; only the listed IDs are unlocked; request-level "giữ …" |
| Building relocation | Pass | Moves to a lot that already touches a road, after authorization; no new roads |
| Road operations | Pass | "connect roads", tile add/remove by coordinates, `preserveRoads` conflict, roads unchanged when preserved |
| Population and housing invariants | Pass | Impact (displaced or re-housed residents, player home); simulation invariants via the shared reducer |
| Preview immutability, atomic approval, stale revisions | Pass | Unit (`PlanReview`) and e2e (save before and after preview, manual edit makes the plan stale) |
| Undo/redo and save/load | Pass | e2e: demolition undo, redo, reload |
| UX | Pass | Plan-panel target choice, authorization, impact list, wrong-service and recovery cards, preview and confirmation (screenshots `docs/ai-architect/screenshots/01`–`06`, reviewed) |
| Housing integration | Pass | AI-built housing keeps a room for the waiting character, who moves in, walks and reloads (unit and e2e) |

### Live Gemini check (bounded, local key; credentials never printed)

Model `gemini-3.5-flash-lite`, 4 requests in total. The test city had one apartment because a second test placement
did not fit.

| Prompt | Structured intent from Gemini | Planner result |
| --- | --- | --- |
| Xây 2 biệt thự gần công viên | 2 villas, near park | `VALIDATED`, 2 placements (before the 2.0 changes) |
| Phá apartment đi. | `demolishTargets: [{apartment, quantity 1}]` | Authorization required (protected), exact building |
| Remove the two apartment buildings but preserve the roads. | `quantity 2`, `preserveRoads: true` | Rejected: "the city has 1" (correct) |
| Xây 10 biệt thự và 2 chung cư, thêm đường kết nối. | 10 villas + 2 apartments | `VALIDATED`, 12 placements |

CI never calls Gemini: the specs use the `mock` and `local` provider modes.

## LIFE MODE HOUSING ACCEPTANCE

### Root cause (reproduced, not assumed)

- **Engine:** reproduction in `packages/simulation/tests/playerHousing.test.ts` ("reproduces the
  bug"). A populated street with every room taken stays fully booked even after a new villa is built.
- **Browser:** a temporary Playwright reproduction on the unfixed code showed three things:
  - after building a villa, the new home held 2/2 residents;
  - the saved world had no player;
  - Life mode asked to create the character again, and every home was still Full.
- **Causes:**
  1. *Welcome residents* uses a population cap of 1000, far above housing, so every room fills.
  2. Every city command re-runs `reconcilePopulation`, which immediately filled any newly built home, so "Build a
     home" was a dead end.
  3. The character draft existed only in React state, so leaving to build lost it.

### Fix

- **Unplaced characters.** `player.create` without a home creates the character with movement status `unplaced`.
  - It is validated, saved and reloaded, never rendered, and never progresses needs.
  - `player.move-in` is its spawn.
- **Held room.** While a player has no home (unplaced, or after losing it), population reconciliation stops creating
  *new* residents when one free room remains.
  - Existing residents are housed first, so the hold never displaces, evicts or re-homes anyone.
  - Capacities are unchanged, and allocation stays deterministic in building-ID order.
- **Placed players** keep the existing rule: their home counts one room for them (`capacity − 1` for residents).
- **UX:**
  - The picker explains full housing with real counts and offers **Build a home**.
  - The character is saved and waiting; a **Back to home selection** chip and the Life tab lead back.
  - A notice names the home that now has a free room, and new homes get a **New** chip and gold halo.
  - Availability refreshes after every city change, and the phone layout keeps the map visible while building.

### Criteria

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Character creation works | Pass | Unit, App and e2e tests |
| 2 | Full housing handled correctly | Pass | Recovery region with real counts; the character is kept (App and e2e tests) |
| 3 | Player can build or obtain valid housing | Pass | e2e builds a villa from the recovery flow; AI batch unit test |
| 4 | Residents don't consume the reserved place | Pass | Repeated reconciliation, re-enable, road edits, undo/redo (unit); 1 of 2 rooms taken in the new villa (e2e) |
| 5 | Player can move into a valid home | Pass | e2e (desktop and phone) |
| 6 | Player spawns | Pass | e2e: Welcome notice, Life HUD, inside the new villa |
| 7 | Player can walk and interact | Pass | e2e walk after recovery; existing journey still meets a resident |
| 8 | Save/reload preserves housing | Pass | e2e reload gives an identical player; unit round-trip of the unplaced state |
| 9 | No silent displacement | Pass | Every original resident keeps their home (unit and e2e); demolition removes only that home's residents |
| 10 | Capacity and invariants | Pass | `validateWorld` and per-home capacity checks after every step in `playerHousing.test.ts` |
| 11 | Browser e2e passes | Pass | 35/35 (2 new housing journeys) |

Also covered:
- apartment builds (23 residents and the player);
- normal filling after the player moves in;
- homes moved;
- demolition of the player's home followed by reassignment;
- undo/redo of the new home;
- AI batch building then move-in;
- legacy fully occupied saves (no character created);
- a character created before residents arrive (room reserved up front).

### Test results (2026-10-12)

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm test` | 123 passed |
| `npm run test:simulation` | 270 passed (9 new housing tests) |
| `npm run test:architect` | 31 passed |
| `npm run security` | 0 findings |
| `npm run build` | Pass |
| API pytest | 61 passed |
| `npm run test:e2e` (mock Gemini) | 35 passed (2 new housing journeys; full-housing test updated to the kept-character behavior) |

Screenshots (reviewed): `docs/life/screenshots/16-no-free-home.jpg`, `22-recovery-build-mode.jpg`,
`23-recovery-new-home.jpg`, `24-recovery-moved-in.jpg`.

### Limitations

- Recovery needs new housing: by design, nobody is moved out. An explicit, user-approved resident relocation was not
  added.
- The held room is one room city-wide, kept in the last home that has space in building-ID order. The player may
  pick any free room.
- There is no "delete character" action; a waiting character stays until it moves in.

### Combined test results (2026-10-12, after AI Architect 2.0)

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm test` | 127 passed |
| `npm run test:simulation` | 270 passed |
| `npm run test:architect` | 52 passed (21 new AI Architect 2.0 tests) |
| `npm run security` | 0 findings |
| `npm run build` | Pass |
| API `uv run --locked --extra dev python -m pytest -q -W error` | 66 passed (5 new) |
| `npm run test:e2e` (mock and local providers, no paid calls) | 39 passed (4 new in `e2e/ai-architect-2.spec.ts`) |

Real browser verification:
- **A. AI Architect building and demolition:** `e2e/ai-architect-2.spec.ts` drives build, choose, authorize,
  preview, confirm, undo, redo and reload against the real API.
- **B. Life Mode housing:** `e2e/life-mode.spec.ts` covers create character, full housing, build a villa, choose a
  home, spawn, walk and reload (desktop and phone). The AI variant (AI builds the housing) is in
  `ai-architect-2.spec.ts`.

### Overall

Both systems pass their acceptance criteria.
