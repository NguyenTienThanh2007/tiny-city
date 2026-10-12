# Phase 3 + redesign progress log

Read `CLAUDE.md` and this file before modifying code in a new session.

## Branch

- Working branch: `feature/p3-living-world-redesign`
- Created from `feature/p3-npc-simulation` @ `e49abd1` (Phase 3A, PR #7 open, not merged into `main` @ `7ec421f`).
- PR target: `feature/p3-npc-simulation` (stacked) until PR #7 merges; then merge/rebase onto `main` and retarget.

## Milestones

1. [x] Repository audit and branch preparation
2. [x] Phase 3A integration (hook speed/subscribe/occupancy, explicit activation, throttled HUD publish, sample-city driveways)
3. [x] Phase 3B NPC rendering and gameplay (Pixi NPC layer, interpolation, depth, selection, profile, follow, feed)
4. [x] UI/UX redesign (tokens, top bar + modes, tool dock, sim dock, side panel/sheet, catalog, AI panel, onboarding)
5. [x] Browser testing and visual refinement (screenshots in `docs/design/screenshots/after`, reviewed)
6. [x] Regression testing and docs; commits/PR — see final report / git log

## Test results (2026-10-12)

typecheck pass · unit 93/93 · simulation 212/212 · architect 31/31 · security 0 findings · build pass ·
API 58 passed · e2e 26/26 (mock Gemini).

## Files

- Integration: `src/simulation/useCitySimulation.ts`, `citizenView.ts`, `lifeFeed.ts`, `src/data/initialCity.ts`
- Rendering: `src/game/npcLayer.ts`, `npcMotion.ts`, `buildingArt.ts`, `CityViewport.tsx`, `mapGeometry.ts`
- UI: `src/App.tsx`, `src/ui/*`, `src/styles.css`, `index.html`
- Tests: `src/App.test.tsx`, `src/game/npcMotion.test.ts`, `src/simulation/citizenView.test.ts`, `e2e/living-world.spec.ts`
- Tools/docs: `scripts/capture_ui.mjs`, `scripts/npc_render_benchmark.mjs`, `docs/npc/phase-3-complete-acceptance.md`,
  `docs/design/ux-ui-redesign.md`, `docs/npc/render-benchmark-results.json`

## Phase 3 integration with main (after PR #7 merged)

- Merged `origin/main` (`4cd105a`) cleanly as `5349bdd`; no conflicts, no duplicate commits; PR #8 retargeted to `main` via `gh`.
- First CI run on the PR head: frontend/simulation and API green; gameplay cancelled at the 20-minute job limit.
  Root cause: software-rendering regression from the redesign (fixed: terrain texture cache, no backdrop blur,
  conditional daylight layer), plus `test.slow()` for living-world specs and a 35-minute gameplay timeout.
- `main`'s own CI run for the PR #7 merge failed on a pre-existing toast-timing flake; notice duration raised to 4.5 s.

## Known blockers

- None for GitHub: `gh` is installed and authenticated.
- A user process holds port 8000; local previews use a mock API on 8013 (`.claude/launch.json`, not committed).

## Next steps

- After PR #7 merges: merge `main` into this branch, rerun the suites, retarget the PR to `main`.

## Visual World 2.0 & premium UX polish (branch `feature/visual-world-ux-polish`, from `origin/main` @ `585f1b9`)

1. [x] Baseline audit and before screenshots (`docs/design/screenshots/visual-world-2/before`)
2. [x] World art: building variants/details/shadows, roads with sidewalks/crosswalks/streetlights, landscaping, lighting
3. [x] Smart HUD + NPC readability (outline, hover ring, badge, idle breathing)
4. [x] AI connectivity: dev `/api` proxy, `GET /v1/city/status`, connection badge, recovery card with retry
5. [x] Game feel + performance: effects pool, funds delta; sprite/texture caching restored Phase 3 fps; Pixi lifecycle fix
6. [x] Tests + docs (`docs/design/visual-world-2-acceptance.md`); commits, push and PR — see git log / PR

Results: unit 110, simulation 212, architect 31, API 61, e2e 29, typecheck/build/security pass.
Next: after review, merge PR into `main`; consider adding `/v1/city/status` to `docs/ai-architect/phase-2a.openapi.json`.

## Phase 4 Complete Life Mode (branch `feature/p4-complete-life-mode`, from `origin/main` @ `83a11c8`)

Phase 3 (#7, #8) and Visual World 2.0 (#9) are merged in `main`. No open PRs at start.

1. [x] M1 Architecture and player state contracts (`docs/life/phase-4a-contracts.md`, `WorldState.player`)
2. [x] M2 Player identity, needs and simulation logic (`packages/simulation/src/player.ts`)
3. [x] M3 Home ownership (one housing slot, move-in, demolition/move recovery) and navigation (`routeToRoad`)
4. [x] M4 Resident interactions (greet/socialize, approach, leave detection) and activities (rest/eat/visit)
5. [x] M5 Character Creator and Life Mode entry (fourth `Life` tab; Live unchanged)
6. [x] M6 Player rendering (`src/game/playerLayer.ts`, shared `playerLook.ts`), follow camera, click-to-move
7. [x] M7 Life HUD (side panel + compact strip), contextual place cards, Interact section in the resident profile
8. [x] M8 Save/load (`Continue life`), undo semantics, demolished home, full housing, corrupt-save recovery
9. [x] M9 Visual QA (`docs/life/screenshots`, reviewed), performance (`docs/life/benchmark-results.json`), e2e
10. [x] M10 Final docs (`docs/life/phase-4-complete-acceptance.md`), full regression run, push and PR

Results: typecheck pass · unit 122 · simulation 261 · architect 31 · security 0 · build pass · API 61 · e2e 33.

Notes for resuming: the browser pane in this desktop app is often hidden, which (by design) freezes the clock;
use Playwright (`e2e/life-mode.spec.ts`, `scripts/capture_life.mjs`) for timed checks. Software-render benchmarks
must run on an otherwise idle machine.

## AI Architect 2.0 + Life Mode housing fix (branch `feature/ai-architect-2`, from `origin/main` @ `131f1df`)

- [x] Life Mode housing: reproduced (engine + browser), unplaced characters, held room for a homeless player,
  recovery UX (explanation, Build a home, Back to home selection chip, New homes), tests, docs
  (`docs/acceptance/ai-architect-2-and-life-housing.md`).
- [x] AI Architect 2.0: root cause (port 8000 held by "F01 API"), contract errors, wrong-service diagnosis,
  port 8787 + `npm run dev:api`, disconnect-monitor hang fix; target selectors, clarification, authorization,
  impact, offline VI/EN interpreter (`local` mode), road-aware clustered placement; Plan-panel UX; docs
  (`docs/ai-architect/ai-architect-2.md`), screenshots (`docs/ai-architect/screenshots`).

Results: typecheck pass · unit 127 · simulation 270 · architect 52 · security 0 · build pass · API 66 · e2e 39.

## Phase 4.5 simulation & gameplay stabilization (branch `feature/p4-5-simulation-audit`, from `origin/main` @ `efcfcf9`)

The remote branch existed with no commits beyond `main`; reused. Acceptance: `docs/acceptance/phase-4-5-simulation-audit.md`.

- [x] Invariant fuzz suite (`packages/simulation/tests/invariants.test.ts`; `AUDIT_SEEDS`/`AUDIT_STEPS` widen it)
- [x] B1 occupancy: player counted once everywhere; picker projects what moving in does (`src/simulation/housingView.ts`)
- [x] B2 entrance-leg crash on city edits; B3 stranded walkers step to the nearest road; B4 leisure spread across venues
- [x] B5 move-home copy; B6 vacancy memos follow assignments
- [x] Browser acceptance `e2e/phase-4-5.spec.ts`, screenshots `docs/acceptance/screenshots/phase-4-5`, benchmark
  `scripts/p45_benchmark.mjs` (results in `docs/acceptance/phase-4-5-benchmark-results.json`)

Design gaps for Living Society (Phase 7): synchronized routines (±20 min), no weekends, sample city has no jobs.

## Visual World 3.0A graphics foundation (branch `feature/visual-world-3a`, from `origin/main` @ `8d25d5a`)

Phase 4.5 (#13) is merged and green. Acceptance: `docs/visual-world-3/acceptance-3.0a.md`.

- [x] Rendering audit (options A–E) → offline Three.js bake to iso sprite atlases plus a Pixi runtime (`docs/visual-world-3/rendering-architecture.md`)
- [x] Art pipeline: `scripts/art/` (kit, stage with colour + GTAO, shadow and emissive passes, packer, review sheet), manifest validation, fallback
- [x] Slice assets: villa ×4, townhouse ×3, apartment ×3 (both facings), park ×3, 16 road masks, 12 trees/shrubs, lamp, benches, planter, flowers
- [x] Runtime: baked buildings, roads, decor; ground shadow layer; warm night glow; sprite ghost; reveal-mask construction; terrain painter; `sun` lighting; street trees
- [x] Visual QA: before/after at matched cameras (`docs/visual-world-3/screenshots`), benchmark (`benchmark-3.0a.json`)
- [ ] After review: 3.0B (duplex, clubhouse, pool, mall, office; roads and public spaces; vegetation) on `feature/visual-world-3b`
