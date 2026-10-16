# Browser acceptance: Phase 8B

- **Baseline:** `main` at `96437da` (Phase 8A merged, PR #25).
- **Branch:** `feature/p8b-living-world-3d`.
- **PR:** [#26](https://github.com/NguyenTienThanh2007/tiny-city/pull/26). Draft until every check passes; never merged without explicit approval.

## Scenarios A–U

Each scenario runs in a real browser (Playwright Chromium, production build, the mock API). e2e tests run under SwiftShader in CI mode. Captures and benchmarks use the hardware GPU.

| | Scenario | Where it is checked |
|---|---|---|
| A | Enter and see the actual city | `phase-8b-living-world.spec.ts` test 1: the 3D buildings, stops and road tiles equal the saved world's plan, with no stand-ins. Screenshots 01, 14, 15b. |
| B | Walk from a villa street to a commercial district | Video `motion-districts-walk`: real keys from the Wave Villa street to the high street. 8A's spec covers walking, running and collision. |
| C | Real NPCs walking | Test 1: every drawn resident is a real citizen, unique, in the mode the simulation gives it, at its simulated position. Screenshot 02, video `motion-npc-walking`. |
| D | Inspect a real NPC by name | Test 1: the waiting resident beside the stop is offered by name, E opens their record, and the record matches the saved citizen. Screenshot 10. |
| E | Real vehicles driving | Test 1: drawn vehicles are real simulation vehicles, unique. Screenshot 03, video `motion-cars-turning`. |
| F | Real bus movement | Test 1: drawn buses are the line's buses. Screenshots 04, 05, video `motion-bus-movement`. |
| G | Real passengers | Test 1: `hidden.riding` equals the buses' passengers, and riders are never drawn. Screenshots 05 → 04. |
| H | Social activity at a venue | Test 1: venue visitors are drawn at their venue with a present outing. The unit test checks concert attendees. Screenshots 07, 08, 09. |
| I | Inspect a café or shop | Test 3: the character, walked to Market Street by `player.move-to`, faces Corner Café and E opens its record: heading, Inside now and Eat here. The world is unchanged. Test 1 inspects the player's villa. The unit test checks the inspector's occupancy and venue rows against the simulation. Screenshot 11 (Harbour Arcade). |
| J | Sunset | Test 3: the view agrees with the saved minute and is golden at 18:40. Screenshot 12. |
| K | Night streetlights | Test 3: night, glow 1, sun 0, lamps > 2, windows > 1. Screenshot 13, video `motion-day-night`. |
| L | Switch views repeatedly | Test 2: switching while paused leaves the world byte-identical. 8A test 4: repeated switching releases GPU resources (heap and canvas checks). Video `motion-mode-switching`. |
| M | Build and see it in 3D | Test 2: a park built in the City View appears on the next visit (`lastSync.added` 1); entities match the plan. |
| N | Demolish and verify removal | Test 2: demolished in the City View, gone from 3D (`lastSync.removed` 1). The collider goes with it (unit test). |
| O | Change speed | Test 2: 4× from the Character View's own clock card runs the one clock faster. |
| P | Pause stops movement | Test 2: paused, the tick and every drawn resident stay put. |
| Q | Save and reload | Test 2: save from the Character View, reload: same city, residents and vehicles, nothing duplicated. Unit test: a reloaded world gives the same scene. |
| R | Collisions and controls | `phase-8a-immersive.spec.ts` (WASD, Shift, orbit, zoom limits, villa collision, spawn, Esc and pointer lock) on the 8B renderer; 8A's controller and collision unit tests. |
| S | Transport stays correct | `phase-6-transport.spec.ts`; simulation transport and fuzz tests (unchanged). The renderer never writes to transport (unit test: computing the scene leaves the world byte-identical). |
| T | Social and economic accounting | `phase-5-economy.spec.ts`, `phase-7-society.spec.ts`; simulation invariants. Inspecting changes nothing (test 1, byte-identical). |
| U | Cloud saves and authentication | `account-cloud-saves.spec.ts`, `guest-session.spec.ts` (guests make no failed requests and log no console errors). |

Loading an 8A save in 8B: `phase-8a-immersive.spec.ts` opens 8A-format saves (Palm Terrace and a legacy save without designs) with the 8B renderer. 8B adds no save fields, so the 3D scene is rebuilt from the authoritative world and no render cache is serialized.

## Invariants

| Invariant | Where |
|---|---|
| No duplicate drawn IDs | Unit (`check`), e2e test 1 |
| No missing or fabricated entities | Unit: every drawn resident exists, with its name; drawn ∪ hidden = all citizens; e2e: drawn ⊆ simulation |
| No renderer-driven economy, transport or society changes | Unit: computing the scene leaves the serialized world identical; e2e: inspecting and switching leave it byte-identical |
| One clock | e2e test 2 (paused switch); the engine calls only `host.advance` |
| No NaN coordinates | Unit: every drawn resident position is finite, in the scene model and after interpolation |
| No orphan colliders | Unit: a removed road stops being walkable at once; building solids belong to their entry |
| No retained disposed resources | Unit: `releaseGpuResources` disposes every geometry, material, texture and instanced mesh; 8A test 4 (heap after GC) |
| No movement while paused | Unit (interpolation with dt = 0); e2e test 2 |
| Deterministic replay | Unit: the same state, stepped in one call or tick by tick, gives the same world and scene |

## Tests

| Suite | Result |
|---|---|
| Typecheck (all packages, app, e2e) | Pass |
| Frontend (Vitest) | 288 passed. 15 are new 8B tests: `sceneModel.test.ts` (8: static mapping and diffs, all-day actor invariants, purity, stop slots, interaction targets) and `livingWorld.test.tsx` (11: sidewalk offset, concert attendees, deterministic replay at any speed, sky smoothness, shelter collision, road-edit collision, GPU release, resident interpolation and snapping, draw budget, save/load scene identity, building and café inspection) |
| Simulation (Vitest) | 429 passed (unchanged: 8B adds no simulation rules) |
| AI Architect | 78 passed |
| API (pytest `-W error`) | 81 passed |
| Production build, secret scan | Pass; 0 findings |
| Playwright, the 3D specs (CI mode, SwiftShader, locally) | 7/7 (8A 4 + 8B 3) in 4.2 min |
| Playwright, full suite | On GitHub Actions in two shards. The 3D specs are both in shard 2 (shard 1 already ran ~46 min on main). |

The required checks (`api`, `frontend-and-simulation`, gameplay shard 1/2, gameplay shard 2/2, `gameplay`) are recorded on the PR for its final commit.
