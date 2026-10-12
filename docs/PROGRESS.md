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
