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
- [x] 3.0B shipped on `feature/visual-world-3b` (see below)

## Visual World 3.0B buildings & environment (branch `feature/visual-world-3b`, from `origin/main` @ `e5923c3`)

3.0A (#14) merged. Acceptance: `docs/visual-world-3/acceptance-3.0b.md`.

- [x] Deterministic bakes (seeded `Math.random` for GTAO noise); material detail textures and world UVs; props kit
- [x] All nine building types redesigned (villa, duplex, townhouse, apartment, park, clubhouse, pool, mall, office)
- [x] Vegetation (mature canopies, new species), textured roads, plaza tile, denser landscaping, curb furniture, home framing
- [x] WebP + skyline packing + half-resolution soft atlas (99 assets, 1.63 MB); alpha-mask picking; art heights; decor LOD
- [x] Matched 3.0A/3.0B screenshots (`screenshots/3b-*`), benchmarks (`benchmark-3.0b.json`), tests
- [x] 3.0C shipped on `feature/visual-world-3c` (see below)

## Visual World 3.0C characters, animation & atmosphere (branch `feature/visual-world-3c`, from `origin/main` @ `78c6927`)

3.0B (#15) merged. Acceptance: `docs/visual-world-3/acceptance-3.0c.md`.

- [x] Baked character rig (layered, tintable, 5 poses × 2 facings), deterministic resident looks, saved player appearance
- [x] Animation: walk by displacement, de-synced idles, greeting/chat poses, real venue visitors (park, pool, terrace)
- [x] Lot-aware depth; Character Creator and portraits use the baked figure
- [x] Lighting: smooth cinematic keys, night light pools, window life, foliage sway, shimmer, fireflies; pause and reduced motion freeze
- [x] Matched 3.0B/3.0C shots and animation sequences, population benchmarks (20–1,000), tests (unit 173, e2e 46)
- [ ] Next: Camera & Zoom Fix (audit cameraRequest handling), then Phase 5 Economy

## Main CI recovery (branch `fix/main-ci-recovery`, from `origin/main` @ `5aec726`)

- [x] Root cause 1 (run 38365939970, 22 failures): every signed-out page load called `GET /v1/auth/me`, which answers 401; Chromium logs that as a console error and the e2e specs fail on any console error. Fix: `GET /v1/auth/session` (200 for guests and users) for the start-up check; `/me` and all account endpoints still return 401. The PR #17 test-side 401 allowance is removed.
- [x] Root cause 2 (run 38380000164, cancelled; same six Life/AI failures on PR #18's first run): the baked player figure (3.0C) re-encoded a PNG every 115 ms in the Character Creator and on every ~100 ms HUD refresh for the Life portrait, on GPU-backed 2D canvases. Under SwiftShader that kept the main thread blocked for ~5 s of every 5 s (M2), several seconds per action on slow runners, so the 4.5 s "Welcome home" toast expired before Playwright could read it, and the suite overran the 35-minute job. Fix: cached figure frames on CPU-backed canvases (0 long tasks with the Creator open), toast lifetime counted from its first frame.
- [x] Hardening: game-time e2e waits (`e2e/support/gameTime.ts`; game time follows the frame rate), a settled-camera wait, Playwright `globalTimeout` 50 min under a 60-minute job, traces uploaded on cancel.
- [x] Regression tests: API session test, auth unit tests, `e2e/guest-session.spec.ts`

## Visual World 3.1 premium architecture (branch `feature/visual-world-3-1-architecture`, from `origin/main` @ `01ec34d`)

PR #18 merged; main CI 38409390925 green. Docs: `docs/visual-world-3/architecture-expansion/`.

- [x] M1 registry, persistent `Building.design`, Style Selector, exact preview and construction, compatibility tests
- [x] M2 six Luxury Minimalist villas; M3 duplexes, townhouses and apartments (4 each); M4 commercial and public models (37 new in total)
- [x] M5 AI Architect: design intent, validation without substitution, previews of exact models, approval records designs
- [x] Screenshots (20 required views plus matched before/after against 3.0C), long-session renderer test, phone
- [x] M6 performance write-up, acceptance doc, GitHub Actions 3/3 (merged as PR #19, `57225d0`)

## Phase 4.6 camera stability & Life View (branch `feature/p4-6-camera-life-ux`, from `origin/main` @ `57225d0`)

Docs: `docs/phase-4-6-camera-life/`. Root cause: every wheel event was a full step (zero/sideways deltas zoomed out), steps
were not inverses (1.1 × 0.91), and nothing bounded the camera, so trackpad scrolling shrank the city into the cursor's
corner (pose ended at world (4439, −894), zoom 0.08).

- [x] M1 reproduction (`scripts/p46_camera_repro.mjs`), root cause, coordinate systems and invariants
- [x] M2 `src/game/camera.ts` single pose, invertible proportional zoom, bounds, measured insets, DPR, unit tests (A–N)
- [x] M3 City View / Life View, Focus, Follow, glides, reduced motion, renderer-recreation-safe camera
- [x] M4 one camera control group, off-screen locator, nearby name tags, drag-to-pan, pinch, phone layout
- [x] M5 `e2e/phase-4-6-camera.spec.ts` (scenarios A–J), screenshots, benchmark
- [x] M6 PR #20, GitHub Actions 3/3 (merged as `fe78a9e`)

## Phase 5 living economy (branch `feature/p5-living-economy`, from `origin/main` @ `fe78a9e`)

Docs: `docs/phase-5-economy/`. One deterministic daily settlement in the simulation package (integer dollars, fixed-direction
ledger, idempotent on `lastSettledDay`); the City economy panel, inspector cards and AI plan estimates read it.

- [x] M1 audit of money systems, `WorldState.economy`, monetary model, accounting invariants, unit + fuzz tests
- [x] M2 treasury: tax policy, revenue, upkeep, settlement, history, bankruptcy boundary (never below zero)
- [x] M3 residents: real job assignments, wages with payroll withholding, accounts, support, savings-bounded spending
- [x] M4 businesses: offices (external clients) and malls (local shopping, staff capacity), pass-through accounts, status
- [x] M5 City economy panel, history charts, policy estimates, building/resident cards, phone sheet
- [x] M6 AI plan economics (confirmed vs estimated), economy-aware saves, older saves (no retroactive bill), undo/redo rule
- [x] M7 browser acceptance, benchmarks, screenshots, PR #21 (merged `a38ae68`); CI sharding recovery PR #22 (merged `3e81022`)


## Phase 6 living transportation (branch `feature/p6-living-transportation`, from `origin/main` @ `3e81022`)

Docs: `docs/phase-6-transportation/`. Vehicles are simulation entities (`WorldState.transport`): lane network from the
road tiles, integer movement, junction reservations, congestion from lost progress, bus lines, mode choice, economy bridge.

- [x] M1 audit, lane network, contracts, graph tests
- [x] M2 vehicles, movement, merging, junctions, reconciliation after edits/undo (fixed identical-plan undo on main)
- [x] M3 congestion, routing penalties, remembered slowdown, traffic overlay
- [x] M4 stops, lines, dispatch, boarding/alighting, capacity, Transport panel line editor
- [x] M5 baked vehicle art (5 models × 16 headings, night lamps), renderer, shelters
- [x] M6 fares / car costs / bus operations, inspectors, Life Mode compatibility
- [x] M7 browser e2e, captures, benchmarks, acceptance, PR #23, GitHub Actions (all 5 checks green on `60daed4`)

## Phase 7 living society (branch `feature/p7-living-society`, from `origin/main` @ `2838fdd`)

- [x] M1 audit, society state contracts, identity-derived personalities, migration, determinism
- [x] M2 relationships, needs, utility decisions with reasons, weekdays/weekends, group outings, visits
- [x] M3 eight venues in the catalog, attendance through Life + transport, purchases and venue businesses
- [x] M4 city calendar, player events, capacity, attendance, cancellation, event costs
- [x] M5 baked venue art, venue crowds and lights, resident/venue/society UI, feed, spread hiring
- [x] M6 Life Mode venues (visit, eat out, events), AI Architect venue types (EN/VI, entertainment district)
- [x] M7 benchmarks, captures, docs, full e2e, PR #24 and GitHub Actions (merged as `45bbea7`)

## Phase 8A immersive third-person Character View (branch `feature/p8a-immersive-third-person`, from `origin/main` @ `45bbea7`)

Docs: `docs/phase-8a-immersive/`. A Three.js Character View over the same live world; movement through the validated
`player.walk` command; the bake's procedural models built in real time.

- [x] M1 audit, hybrid renderer boundary, coordinate convention and tests, `player.walk` in the simulation
- [x] M2 real 3D neighbourhood: roads, sidewalks, villas (exact City View models), landscaping, sea, sky and lighting
- [x] M3 character from the bake rig and appearance mapping, WASD/run controller, animation, collision
- [x] M4 orbit camera: follow, orbit, zoom, limits, obstruction, pointer lock, settings
- [x] M5 Enter World / Return to City, spawn and recovery, authority bridge, save/load, nearby residents and vehicles
- [x] M6 draw-call reduction, light preset, shader warm-up, leak fixes (per-step world clone, renderer retention)
- [x] M7 unit + browser acceptance, screenshots and videos, benchmarks, docs, PR #25 (CI on the final commit)

## Phase 8B full living world in 3D (branch `feature/p8b-living-world-3d`, from `origin/main` @ `96437da`)

Docs: `docs/phase-8b-living-world-3d/`. The Character View becomes the whole living city: a pure world scene model
(`src/immersive/world/sceneModel.ts`), an incrementally reconciled city scene kept between visits, real residents and
vehicles drawn from live state, E-to-inspect through the existing view models, light from the game clock.

- [x] M1 audit of 8A, scene model (stable IDs, static diff, actor modes, interaction targets) and its tests
- [x] M2 whole-city scene: every building type, roads, stops, landscaping; near / mid / far levels; solid shelters; reconciliation after edits
- [x] M3 real residents: `citizenLook` skinned characters, interpolation, sidewalks, stop slots, venue spots, hidden counts
- [x] M4 real vehicles and buses: City View motion model, instancing per model and colour, passenger signs, riders hidden
- [x] M5 social world: venue visitors and event attendees from real attendance; resident / building / stop inspection
- [x] M6 day/night and lights from the clock, speed buttons, draw-call and triangle reductions, benchmarks at 19–995 residents
- [x] M7 browser acceptance (3 e2e tests in shard 2), unit tests, 16 screenshots and 6 videos, docs, PR #26
