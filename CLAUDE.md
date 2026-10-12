# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TINY CITY: a city-builder prototype. React 19 + Vite + TypeScript + PixiJS 8 frontend (`src/`), two npm workspace packages (`packages/simulation`, `packages/ai-architect`), and a FastAPI backend (`apps/api`, Python 3.12, managed with `uv`). Node 22.12+ (CI uses Node 24).

## Commands

From the repo root:

```sh
npm ci
npm run dev              # builds simulation → ai-architect, then starts Vite
npm run typecheck        # all packages + app + e2e tsconfig
npm test                 # frontend Vitest (jsdom), src/**/*.test.{ts,tsx}
npm run test:simulation  # simulation package tests
npm run test:architect   # builds, then runs ai-architect tests
npm run build
npm run security         # scripts/check_secrets.py
npm run bench:npc        # NPC engine benchmark
npx playwright install chromium && npm run test:e2e
```

Single test: `npx vitest run src/App.test.tsx -t "name"` (root), or `npm test --workspace @tiny-city/simulation -- tests/npc.test.ts -t "name"`. Single e2e: `npx playwright test e2e/city-builder.spec.ts`.

Workspace packages are consumed via their built `dist/` ESM exports, not source. Root `dev`/`build`/`test` have `pre*` hooks that rebuild simulation → ai-architect, but if you run a workspace's tests or the API directly after editing `packages/simulation`, rebuild first (`npm run build:architect` builds both).

API (from `apps/api`; requires `npm run build:architect` at root first because the API shells out to the built TS worker):

```sh
uv sync --locked --extra dev
uv run --locked --extra dev python -m pytest -q -W error
uv run uvicorn tiny_city_api.main:app --host 127.0.0.1 --port 8787
```

CI (`.github/workflows/phase-0-ci.yml`) runs: typecheck, test:architect, security, test:simulation, test, build; API pytest; Playwright e2e.

## Architecture

**`@tiny-city/simulation` is the single source of truth.** Headless, zero runtime deps, deterministic (fixed-timestep clock, seeded RNG with serializable state). It owns the building catalog/prices/footprints, city commands (build/move/demolish/road, atomic batches), occupancy grid, road graph, budget, IDs, events, and schema-2 serialization with legacy migration. Other layers must import its rules rather than duplicate them.

**Frontend (`src/`)** treats the old editor `CityState` as a compatibility projection: `src/simulation/cityAdapter.ts` converts editor data into a `CityPlan` once (`toCityPlan`) and projects `WorldState` back (`projectCity`). `useCitySimulation` wraps one `Simulation` instance; all edits go through `execute`/`executeBatch`. Pixi's ticker (`CityViewport.tsx`) is the only frame driver and calls `advance` (capped at 250 ms, skipped when hidden/paused). Only visual styles and construction timestamps are frontend-only metadata. Undo/redo uses city snapshots (`restoreCity`) without resetting the clock. Saves (`citySave.ts`) go to browser storage and include the simulation snapshot; legacy map saves still load.

**`@tiny-city/ai-architect`** produces deterministic plan proposals and validation/repair on top of simulation rules. It has two entry points: a browser export (`createProposal`, `PlanReview`, wire contracts) and a Node worker `dist/worker.js` (JSON over stdin/stdout). Its build also generates `dist/catalog.json` via `scripts/export_architect_catalog.mjs`.

**FastAPI (`apps/api/tiny_city_api`)** uses Gemini (Google Gen AI SDK) only to interpret bilingual (Vietnamese/English) intent, then calls the TS planner through `planner_bridge.py`, a bounded subprocess to `packages/ai-architect/dist/worker.js` with credentials stripped from its env. The API is stateless and has no apply endpoint.

**AI plan flow:** prompt → `/v1/city/plan` → proposal shown as a temporary map preview → frontend re-validates with `PlanReview` (AI output is untrusted) → only "Approve & build" commits it as one simulation batch through the normal history path.

**NPCs (Phase 3A)** are opt-in: `createWorld({..., population: {maxCitizens}})` or `simulation.enablePopulation()`. Worlds without it keep legacy behavior. Residents get housing/jobs, daily routines, and progressive road navigation (`population.ts`, `life.ts`, `navigation.ts`); city edits, history and serialization reconcile NPC references.

**Living world UI (Phase 3B)**: residents are drawn by `src/game/npcLayer.ts` from `getWorld()` (the live snapshot) inside the Pixi ticker, never via React props; `npcMotion.ts` holds the pure interpolation/appearance/depth helpers. Buildings and residents share one `sortableChildren` container (`buildingDepth` vs `citizenDepth`). `useCitySimulation` throttles HUD `setWorld` to ~100 ms during routine ticks, so React state can lag the engine slightly; pause publishes fresh state. Speed (1/2/4×) scales the elapsed time fed to the single clock. UI components live in `src/ui/`; styles are token-based in `src/styles.css`. The side panel shows resident > building > mode (Build/Plan/Live); `architectPanelOpen` *is* Plan mode.

Many e2e tests depend on exact accessible names (`Villa $120`, `Road $8`, `Resume`, `Pause`, `Step`, `Save`/`Saved`, `Show/Hide AI Architect panel`, `Center neighborhood`, …), classes (`.inspector`, `.building-details`, `.condition`, `.architect-panel`), the `Simulation clock` text format `DAY 01 · 00:00`, the top bar covering (1100,50), and building roof lift heights in `buildingArt.ts` (used for hit testing). Keep these stable.

**Rendering caveats (Visual World 2.0)**: Pixi `Application`s are created strictly one after another (`pixiLifecycle` in `CityViewport.tsx`) because `Application.destroy()` clears Pixi's global batch pool and a StrictMode remount would otherwise draw with destroyed batches. Don't destroy children of `cacheAsTexture` containers; finished buildings and the roads/flat-landscaping ground are pre-rendered with `generateTexture` into sprites (keyed `BuildingTextures`, `rebuildGround`) and off-stage sources are destroyed a frame later (`DeferredDestroy`). Night lighting is per-container `tint` plus separate unlit window/lamp layers — no full-screen overlays or filters. Building looks come from `buildingVariant(id, kind)`; landscaping from `planDecor(plan)`; both deterministic.

**Life Mode (Phase 4)**: the player is the optional `WorldState.player` (schema 2 unchanged; never auto-created). `Simulation.executeLife(LifeCommand)` applies commands immediately; walking, activities and needs advance only in `runTick` after residents (`packages/simulation/src/player.ts`). The player holds one housing slot (`reconcilePopulation` uses `capacity − 1` for their home) and is reconciled after every city command, undo/redo and AI batch (`reconcilePlayer`); `CitySnapshot` excludes the player, so history never rewinds them. Frontend: `src/game/playerLook.ts` is the single shape spec drawn by both `playerLayer.ts` (Pixi) and `src/ui/PlayerFigure.tsx` (SVG); `src/simulation/playerView.ts` turns events/reasons into text. Life e2e tests rely on accessible names such as `Life`, `Create character`, `Character name`, `Next: choose a home`, `Homes`, `Confirm home`, `Move in & start`, `Current activity`, `Life HUD`, `Nearby residents`, `Interact`, and the meters `Energy`/`Hunger`/`Social`/`Mood`. A hidden browser tab never advances time (by design), so drive timed checks through Playwright.

`docs/PROGRESS.md` is the running log for multi-session work; read it before continuing a milestone. `node scripts/capture_ui.mjs` (needs dev server + mock API) regenerates design screenshots; `node scripts/npc_render_benchmark.mjs` measures browser rendering.

Contract docs live under `docs/` (`simulation/`, `ai-architect/`, `npc/`). Read the relevant contracts doc before changing a public interface.

## Gemini keys and test safety

- `GEMINI_API_KEY` goes only in the gitignored `apps/api/.env` (copy `.env.example`). Never put it in a `VITE_` variable or browser storage. If there's no key, `/v1/city/plan` returns `PROVIDER_NOT_CONFIGURED`. `TINY_CITY_PROVIDER_MODE=mock` turns on a fixed fixture.
- Playwright starts its own servers: a production build plus preview on port 4173, and the API on port 8012 in mock mode with an empty key override, so ordinary e2e runs never make paid calls. Don't change that.
- `TINY_CITY_LIVE_UI=1 npm run test:e2e` runs only `e2e/ai-architect-live.spec.ts` against real Gemini (paid). It's forbidden when `CI` is set. `python -m tiny_city_api.live_smoke` is also paid.
- `VITE_AI_ARCHITECT_API_URL` overrides the default API base URL `http://127.0.0.1:8787`.
- The planner's default port is 8787 (8000 collided with another local app and made every request 404). `npm run dev:api` starts the API, refuses an occupied port and names its owner; `TINY_CITY_API_PORT` is shared with `npm run dev`. Provider modes: `gemini` (paid), `mock` (fixed fixture, used by most e2e specs), `local` (deterministic offline VI/EN rules in `packages/ai-architect/src/interpret.ts`; `e2e/ai-architect-2.spec.ts` talks to a third Playwright server on 8015 in this mode). Every `/v1` failure must use the `{requestId, error}` contract.

**AI Architect 2.0**: demolitions and moves use target selectors (`demolishTargets`/`moveTargets`) resolved deterministically by `resolveTarget` (`packages/ai-architect/src/targets.ts`); never pick one of several matches. Ambiguity returns `clarifications`, protected/destructive edits return `authorization`; the UI re-plans the same intent via `/v1/city/plan/validate` (no second AI call) and still requires preview + destructive confirmation. Proposals carry `impact`. Regenerate `docs/ai-architect/examples` with `node scripts/architect_examples.mjs` after planner changes (the fixture test checks the digest).
