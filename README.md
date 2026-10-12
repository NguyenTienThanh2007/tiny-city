# TINY CITY: Imagine. Build. Live.

A frontend prototype for the Architect Mode milestone. The map renderer uses React, Vite, TypeScript, and PixiJS 8. All first-pass roads and buildings are drawn from vector shapes in PixiJS, so the scene does not depend on downloaded art assets.

## Start the game and AI Architect

Use Node.js 22.12+ (CI uses Node 24). The frontend and simulation are npm workspaces sharing the root lockfile.

```sh
npm ci
npm run dev
```

In another terminal, start the local planning API from `apps/api` after configuring `GEMINI_API_KEY` in the backend-only `apps/api/.env` file. Copy `.env.example` if that file does not exist; never put the Gemini key in a `VITE_` variable or browser storage.

```sh
cd apps/api
uv sync --locked --extra dev
uv run uvicorn tiny_city_api.main:app --host 127.0.0.1 --port 8000
```

In development the frontend calls the planner through Vite's same-origin proxy at `/api` (forwarded to `http://127.0.0.1:8000`; set `TINY_CITY_API_PROXY_TARGET` for another address), so phones and tablets on your LAN that open the dev server also reach the API without CORS changes. Production builds call `http://127.0.0.1:8000` by default. Set `VITE_AI_ARCHITECT_API_URL` only when the API uses another base URL. The AI panel shows the planner connection (reachable, mock/demo mode, provider key configured, planner built) from the cheap `GET /v1/city/status` endpoint and offers Retry and setup steps when the API is unreachable; it never substitutes mock output in a real session. The prompt produces a temporary map preview; only **Approve & build** applies the validated batch through the live simulation.

## Controls

- Choose Select, Road, Move, Bulldoze, or one of the nine building tools from the left toolbar. The rail scrolls on shorter screens.
- Click or drag to paint road tiles. Click a building tool, then an empty lot to place it. Select a building to inspect it.
- Click the minimap to navigate; Center city returns to the saved neighborhood. Use the mouse wheel to zoom. Hold Shift and drag, or use the middle mouse button, to pan.
- Press `V` (Select), `R` (Road), `M` (Move), `1`–`9` (buildings), or `X` (Bulldoze) to switch tools. Press Escape to return to Select.
- Use the AI Architect prompt bar to describe changes in Vietnamese or English. Preview and review cost/warnings first; approving applies one simulation batch. Manual build tools remain available.
- Building and road placement uses the funds shown in the HUD; the sample starts with $24,680.
- All catalog buildings except parks must touch a road along a footprint edge. Parks can be placed independently. The engine validates bounds, coast exclusions, and full tile occupancy.
- The top bar switches between **Build**, **Plan** (AI Architect), **Live** (watch residents) and **Life** (play your own character). Undo/Redo and Save sit at the top right; funds, residents and homes are always visible.
- The simulation dock controls the fixed-timestep clock: play/pause (or Space), 1×/2×/4× speed and Step (one game minute while paused). Speed scales the time fed to the one authoritative clock.
- **Live → Welcome residents** explicitly enables the Phase 3A population for this city (existing saves never change silently). Residents move into homes, take jobs at offices and malls, walk the roads on daily routines (work around 07:00, leisure around 17:00, home by 19:00) and are saved with the city.
- Click a walking resident (Select tool) to open their profile: activity, home, workplace, destination, travel status and daily routine. **Focus** centers the camera; **Follow** tracks them until you pan. Building inspectors list linked residents.
- The Live panel summarizes activities, lists residents on the move and shows a de-duplicated City Life feed (commutes, leisure, population changes, missing jobs, unreachable destinations).
- **Life → Create character**: name and style your character (skin, hair, outfit, colors, accessory), then pick a home with a free room on the map. You take one room; residents are never moved out. Click roads to walk (routes follow real streets), click a building for contextual actions (rest/eat at home, visit parks, walk to the entrance) and click a resident (or use *Nearby residents*) to greet or chat. Energy, hunger, social and mood change with game time only, so pause freezes them and 1×/2×/4× scale them. Follow keeps the camera on you; panning stops it. Your character is saved with the city and continues after a reload.
- Save writes the map and simulation snapshot to this browser. Legacy map saves still load automatically.
- Undo/redo restores map edits without resetting the simulation clock. One road/bulldozer drag is one history entry. Move preserves identity and costs no funds; demolition does not refund construction.

## Verify

```sh
npm run typecheck
npm test
npm run test:simulation
npm run test:architect
npm run build
npx playwright install chromium
npm run test:e2e
```

For API checks, run from `apps/api`:

```sh
uv sync --locked --extra dev
uv run --locked --extra dev python -m pytest -q -W error
```

GitHub Actions runs the same frontend, simulation, API, and Chromium gameplay checks on pull requests to `main` and pushes to `main`. [Integration details](docs/simulation/integration.md) describe the adapter, clock driver, and save format.

Root development, build, tests and typechecking automatically build simulation → architect → frontend; no pre-existing `dist` folders are required. Browser E2E checks also need `uv` and the locked API environment (`uv sync --locked --extra dev --directory apps/api`). Playwright starts fresh production/frontend and FastAPI servers itself. Its API runs on port 8012 in explicit mock mode with an empty key override, so neither local E2E nor CI can make paid Gemini calls. The six AI browser cases cover preview/rejection, atomic approval, history/save/reload, errors, cancellation, stale plans and mobile access. See [Phase 2 integration acceptance](docs/ai-architect/phase-2-integration-acceptance.md).

An optional, separately paid production UI smoke is `TINY_CITY_LIVE_UI=1 npm run test:e2e` after configuring the backend key. It runs one dedicated live spec and is forbidden when CI is set. Keep this flag out of ordinary CI. On narrow screens, **AI options** shows/hides the planning panel so the map and manual inspector stay reachable.

## Prototype boundary

`@tiny-city/simulation` remains authoritative for city commands, footprints, roads, construction spending, IDs, and deterministic saves. AI responses are untrusted proposals; the frontend validates them with `PlanReview` before approval and commits only through the existing simulation/history path. Pixi remains the single frame driver; only styles and construction timestamps remain presentation metadata. Residents are rendered from authoritative snapshots (blended between fixed ticks, never simulated in React/Pixi). Traffic, recurring economy, needs and God Mode are not implemented. See [Phase 1A contracts](docs/simulation/phase-1a.md), [Phase 1B tools](docs/simulation/phase-1b.md), the [Phase 2A frontend integration contract](docs/ai-architect/phase-2a-integration.md), and the [final Phase 1 acceptance audit](docs/simulation/phase-1-acceptance.md).

Phase 3A adds opt-in seeded residents, capacity/job assignment, varied daily routines and progressive road navigation in the headless engine. Existing worlds retain their behavior until `enablePopulation()` is called; managed saves restore automatically. See the [NPC public contract](docs/npc/phase-3a-contracts.md), [typed integration examples](docs/npc/phase-3a-integration.md) and [Phase 3A acceptance](docs/npc/phase-3a-acceptance.md). Run `npm run bench:npc` for the engine benchmark.

Phase 4 Life Mode adds a user-controlled character to the same authoritative world: typed appearance, one housing slot, road navigation, needs, activities (rest, eat, visit, greet, chat), resident interactions, city-edit/undo reconciliation and save/resume, plus the creator, home selection, Pixi player rendering and Life HUD. See the [Phase 4A contracts](docs/life/phase-4a-contracts.md), [architecture](docs/life/phase-4a-architecture.md), [experience](docs/life/phase-4b-experience.md) and [Phase 4 acceptance](docs/life/phase-4-complete-acceptance.md). `node scripts/life_benchmark.mjs` measures engine cost; `node scripts/capture_life.mjs` regenerates the Life screenshots.

Visual World 2.0 adds deterministic building variants, sidewalks/crosswalks/streetlights, landscaping, time-of-day lighting with lit windows, richer placement feedback, a contextual collapsible HUD and planner connectivity diagnostics, while keeping Phase 3 rendering performance. See [Visual World 2.0 acceptance](docs/design/visual-world-2-acceptance.md).

Phase 3B delivers the player-facing living world (Pixi resident sprites, selection, profiles, follow camera, speed controls, City Life feed) and the Coastal Paradise UX/UI redesign. See [Phase 3 complete acceptance](docs/npc/phase-3-complete-acceptance.md) and the [UX/UI redesign notes](docs/design/ux-ui-redesign.md). `node scripts/npc_render_benchmark.mjs` measures browser rendering with 30–1000 residents against a running dev server; `node scripts/capture_ui.mjs` regenerates the design-review screenshots.

## Phase 2A AI architect backend

`@tiny-city/ai-architect` adds deterministic proposals and explicit approval/application through the existing simulation. FastAPI uses the official Google Gen AI SDK for bilingual intent interpretation. The frontend sends natural-language prompts to the backend and keeps proposals in temporary preview state until the player approves them.

See [API contracts](docs/ai-architect/phase-2a-contracts.md), [integration and startup](docs/ai-architect/phase-2a-integration.md), and [acceptance evidence](docs/ai-architect/phase-2a-acceptance.md). Build with `npm run build:architect`; test with `npm run test:architect` and `npm run security`. Credentials belong only in ignored `apps/api/.env`; `.env.example` lists defaults. Ordinary CI uses mocked providers and the real TS planner.
