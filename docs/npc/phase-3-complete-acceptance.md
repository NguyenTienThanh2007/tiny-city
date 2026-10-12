# Phase 3 complete (3A + 3B) and redesign — acceptance

Branch `feature/p3-living-world-redesign`, stacked on `feature/p3-npc-simulation` (Phase 3A, `e49abd1`, PR #7).
Phase 3A engine code is reused unchanged; no new simulation, clock or citizen model was introduced.

## Delivered

### Phase 3A integration (engine reused, frontend wired)

- `useCitySimulation` exposes `enablePopulation`, `getBuildingOccupancy`, `getCitizen`, `resume`, a `subscribe`
  event stream and **speed** (1×/2×/4×). Speed multiplies the real time fed to the single authoritative
  fixed-step clock (`simulation.advance(min(elapsed, 250) × speed)`); no second timer exists.
- HUD state is published at most every 100 ms while only routine `clock.ticked`/`citizen.moved` events occur;
  any other event publishes immediately, and pausing always publishes. Pixi reads the live snapshot every frame,
  so residents never wait on React renders.
- Activation is explicit: **Live → Welcome residents** calls `enablePopulation({ maxCitizens: 1000 })` once.
  The world's `population` field is the source of truth (re-renders never regenerate residents; the button disappears).
  Saves keep the managed population through the existing `saveCity`/`loadCitySave` (schema 2, save envelope v3).
  Legacy saves are not changed until the player activates residents.
- Sample city fix: 7 of the 10 Phase 0 sample villas did not touch a road, so their residents could never leave.
  Nine one-tile driveways now connect every sample home and the park (existing saves are unaffected).

### Phase 3B living world

- `src/game/npcLayer.ts`: one Pixi container per resident, created once per citizen ID and destroyed only when the
  resident is removed. Body parts share cached `GraphicsContext`s (a few dozen GPU contexts for any population).
- Stable look per ID (`citizenAppearance`, FNV-1a): skin, hair color and style (short/long/bun/cap), clothing
  (shirt/dress/jacket), accessories (bag/scarf). The profile avatar uses the same seed.
- Motion (`src/game/npcMotion.ts`): positions are blended between the two latest authoritative ticks using the
  clock's `accumulatedMs / fixedStepMs`; discontinuities (structural revision change with movement, re-entering the
  street, jumps beyond walking range) snap instead of gliding. While paused, sprites settle onto the authoritative
  position so resume continues exactly from there.
- Walk cycle driven by real displacement (legs swing, body bob), facing left/right and front/back from the tile heading,
  right-hand lane offset eased around corners so two-way traffic does not overlap.
- Residents inside a building or on its private entrance leg (`movement.currentBuildingId`) are hidden, with a short fade
  on exit/entry. Residents share one depth-sorted container with buildings; building sort keys sit between the tiles
  behind and in front of every catalog footprint (unit-tested), so walkers pass behind and in front correctly.
- Sprites keep a minimum on-screen size when zoomed out; large populations are culled to the view.
- Selection: click (Select tool) picks the front-most resident near the pointer; hover shows a nameplate and pointer
  cursor. The selected resident gets a pulsing ring, a destination outline (or an "inside" highlight) and the remaining
  route. **Focus** centers the camera; **Follow** tracks them smoothly until the player pans.
- Resident profile, building occupancy lists, Live summary, City Life feed and minimap residents (see the redesign doc).
- City Life feed (`src/simulation/lifeFeed.ts`) folds events: departures to work/leisure/home merged per game hour,
  arrivals home, population changes, residents without jobs, and unreachable destinations (once per destination or
  origin/destination pair per city revision, naming the side that is disconnected).
- Daylight tint follows the authoritative clock once residents live in the city.

### Redesign

See [UX/UI redesign](../design/ux-ui-redesign.md).

## Gameplay flow verified in the browser

Automated in `e2e/living-world.spec.ts` (production build, mock planner) plus the existing suites:

1. City with homes and an office → **Welcome residents** → "8 residents moved in" → 4× until the morning commute.
2. Canvas changes frame-to-frame while residents walk; renderer reports visible residents.
3. Pause, save, pick a walking resident from the saved state, **click them on the map** → profile shows their home,
   "Harbor Office", routine with exactly one current entry.
4. Follow → resume → camera footprint moves with them.
5. Save → reload → Live panel shows 8 residents; the reloaded save equals the saved residents and clock.
6. Bulldoze a road under the commute → every resident still references existing buildings and routes are cleared;
   nobody reaches work while severed; the feed explains the disconnection; Undo → residents reach work.
7. Phone (390×844): Live sheet → resident list → profile → close; tool dock still reachable.

Also covered by unit tests (`src/App.test.tsx`): activation once + save/reload identity, speed scaling of the single clock,
profile data accuracy + follow/close, construction/demolition/undo reconciliation, AI approval housing new residents in
one batch. Existing Phase 1/2 suites cover construction, move, demolish, undo/redo, save/load, AI preview without mutation,
atomic approval, stale-world safeguards, budget validation and migration — all unchanged and passing.

## Test evidence (2026-10-12, macOS, Node 24.16)

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass (strictness unchanged) |
| `npm test` | 10 files, 93 tests passed (was 8 files / 73) |
| `npm run test:simulation` | 12 files, 212 tests passed |
| `npm run test:architect` | 31 tests passed |
| `npm run security` | 0 findings |
| `npm run build` | pass (existing >500 kB chunk warning) |
| `uv run --locked --extra dev python -m pytest -q -W error` (apps/api) | 58 passed |
| `npm run test:e2e` | 26 passed (23 existing + 3 new living-world), mock Gemini only |

## Performance (measured, not estimated)

Headless engine (`npm run bench:npc`, unchanged engine): 100 residents 0.10 ms mean tick; 1000 → 0.97 ms (p95 1.71);
3000 → 3.01 ms (p95 4.43).

Browser rendering (`scripts/npc_render_benchmark.mjs`, results in `render-benchmark-results.json`), commute in
progress, whole grid on screen:

| Residents | Visible | Apple M2 (Metal) fps median / min | SwiftShader fps median | Scene update ms (GPU / SW) |
| --- | --- | --- | --- | --- |
| 30 | 19 | 60 / 59 | 30 | 0.04 / 0.05 |
| 100 | 44 | 60 / 59 | 29 | 0.08 / 0.10 |
| 300 | 218 | 60 / 59 | 17 | 0.19 / 0.24 |
| 1000 | 719 | 58 / 57 | 7 | 0.53 / 0.96 |

"Scene update" is the per-frame JS cost of the viewport ticker (resident sync, culling, selection overlay). No React render
occurs per resident or per frame; no path is recomputed in the renderer.

### CI software-rendering regression found and fixed

The first CI run of this branch showed every browser spec 40–50% slower than on `main` (e.g. 55 s → 80 s per building
spec) and the gameplay job hit its 20-minute limit. Local A/B against the `main` production build under SwiftShader
confirmed it (~10 vs ~18 frames/s; 845 vs 465 ms per canvas screenshot). Causes: `backdrop-filter` blur on the floating
panels re-blurring the live canvas every frame, an always-mounted blend-mode daylight layer, and re-rasterizing ~8k
static terrain triangles per frame. Fixes: opaque paper panels, the daylight layer mounts only while tinted, and the
terrain is cached as a single texture (`cacheAsTexture`) rebuilt only when the map is redrawn. Result: ~25–30 frames/s
and ~380 ms per screenshot, now faster than `main`; the local e2e suite went from 7.3 to 4.7 minutes. The living-world
specs are marked `test.slow()` and the gameplay job timeout is 35 minutes to fit the three new multi-hour simulations.
Trade-off: at maximum zoom on high-DPI screens the grass texture is slightly soft; buildings, roads and residents are
not cached and stay crisp.

## Known limitations

- Activation is not an undo step (it is an explicit, saved world change); undoing earlier city edits keeps residents.
- Clicking residents works with the Select tool; other tools keep their construction meaning.
- Residents walk on road centerlines with lane offsets; there is no traffic or collision avoidance (not in scope).
- Names come from the engine (`<first name> <number>`); the engine provides no occupations beyond the workplace.
- Under software rendering, 1000 visible residents still drop to ~7 fps (GPU hardware holds 58 fps).
- The pre-existing city-builder toast assertions are timing-sensitive on slow CI; notices now stay 4.5 s (was 2.6 s), which removed the flake seen on `main` (clubhouse spec).
- Speed is a session setting and is not saved.

## Future ideas (not implemented)

Night window lights, traffic, needs/economy, resident interaction beyond inspection, God/Life modes.
