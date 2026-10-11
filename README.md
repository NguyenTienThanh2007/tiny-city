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

The frontend calls `http://127.0.0.1:8000/v1/city/plan` by default. Set `VITE_AI_ARCHITECT_API_URL` only when the API uses another base URL. The prompt produces a temporary map preview; only **Approve & build** applies the validated batch through the live simulation.

## Controls

- Choose Select, Road, Move, Bulldoze, or one of the nine building tools from the left toolbar. The rail scrolls on shorter screens.
- Click or drag to paint road tiles. Click a building tool, then an empty lot to place it. Select a building to inspect it.
- Click the minimap to navigate; Center city returns to the saved neighborhood. Use the mouse wheel to zoom. Hold Shift and drag, or use the middle mouse button, to pan.
- Press `V` (Select), `R` (Road), `M` (Move), `1`–`9` (buildings), or `X` (Bulldoze) to switch tools. Press Escape to return to Select.
- Use the AI Architect prompt bar to describe changes in Vietnamese or English. Preview and review cost/warnings first; approving applies one simulation batch. Manual build tools remain available.
- Building and road placement uses the funds shown in the HUD; the sample starts with $24,680.
- All catalog buildings except parks must touch a road along a footprint edge. Parks can be placed independently. The engine validates bounds, coast exclusions, and full tile occupancy.
- Resume/Pause controls the fixed-timestep simulation; Step advances one game minute while paused. The inspector shows the clock and latest simulation event.
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

`@tiny-city/simulation` remains authoritative for city commands, footprints, roads, construction spending, IDs, and deterministic saves. AI responses are untrusted proposals; the frontend validates them with `PlanReview` before approval and commits only through the existing simulation/history path. Pixi remains the single frame driver; only styles and construction timestamps remain presentation metadata. NPC pathfinding, traffic, recurring economy, Life Mode, and God Mode are not implemented. See [Phase 1A contracts](docs/simulation/phase-1a.md), [Phase 1B tools](docs/simulation/phase-1b.md), the [Phase 2A frontend integration contract](docs/ai-architect/phase-2a-integration.md), and the [final Phase 1 acceptance audit](docs/simulation/phase-1-acceptance.md).

## Phase 2A AI architect backend

`@tiny-city/ai-architect` adds deterministic proposals and explicit approval/application through the existing simulation. FastAPI uses the official Google Gen AI SDK for bilingual intent interpretation. The frontend sends natural-language prompts to the backend and keeps proposals in temporary preview state until the player approves them.

See [API contracts](docs/ai-architect/phase-2a-contracts.md), [integration and startup](docs/ai-architect/phase-2a-integration.md), and [acceptance evidence](docs/ai-architect/phase-2a-acceptance.md). Build with `npm run build:architect`; test with `npm run test:architect` and `npm run security`. Credentials belong only in ignored `apps/api/.env`; `.env.example` lists defaults. Ordinary CI uses mocked providers and the real TS planner.
