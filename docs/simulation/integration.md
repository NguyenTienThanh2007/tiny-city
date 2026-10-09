# Phase 0 frontend integration

The existing React/PixiJS city builder now consumes `@tiny-city/simulation` through its public ESM exports. The root npm workspace registers `packages/simulation`; the root lockfile is authoritative for the integrated build. No shared contract package, Gemini integration, or Phase 1 system has been introduced.

## Install and run

Use Node.js 22.12+ (CI uses Node 24). From the repository root:

```sh
npm ci
npm run dev
```

Development, frontend build, and frontend integration tests automatically build the simulation package first. To rebuild its exports directly, run `npm run build:simulation`. The current integration imports production exports, so later simulation source changes must be rebuilt before the frontend can consume them.

## Contract boundary

`src/simulation/cityAdapter.ts` maps the existing editor `CityState` into the public `CityPlan` contract without changing its saved map fields or visual vocabulary.

| Editor building | Simulation kind | Footprint | Capacity metadata |
| --- | --- | --- | --- |
| Villa | `home` | 2 × 2 tiles | 2 |
| Park | `park` | 4 × 4 tiles | 20 |
| Clubhouse | `workplace` | 3 × 3 tiles | 20 |

IDs, names, and tile coordinates are preserved. Roads, funds, construction timestamps, and visual styles remain editor metadata. The Pixi renderer reads canonical building names and positions from `world.plan` and joins them to visual metadata by ID. The original isometric projection, terrain, construction animation, tool handling, pan, and zoom remain in place.

Every builder commit, undo, and redo synchronizes the plan through `Simulation.replacePlan`. That method validates and copies the plan while retaining clock state, random state, citizens, and pending commands. It rejects invalid changes atomically, including removing a building referenced by a citizen. The Phase 0 editor has an empty citizen collection and does not create residents or implement NPC behavior.

## Clock and event flow

`src/simulation/useCitySimulation.ts` owns one simulation runner for the mounted editor. The world starts paused at day 0, midnight; the UI displays this as DAY 01. Defaults remain 100 real milliseconds per tick and one game minute per tick.

`src/simulation/tickerAdapter.ts` connects the existing [Pixi ticker](https://pixijs.com/8.x/guides/components/ticker) to the hook using `ticker.deltaMS`, and removes that listener during viewport teardown. Pixi is the only frame driver; React does not create a second simulation timer.

The hook ignores hidden-tab frames and caps submitted frame deltas at 250 ms to avoid long resume catch-up bursts. Pixi's own delta cap also applies. Fractional time remains in the runner and is included in saves even between published UI ticks. The UI publishes snapshots on executed ticks or explicit controls/edits, rather than rerendering for every fractional frame.

Resume/Pause toggles the runner, and Step executes exactly one tick while paused. The inspector displays game day/time and the latest typed event; the same controls remain visible over the map when the narrow-screen layout hides the inspector. Non-tick events such as `clock.day-started` take precedence within a batch. Time edits do not enter the builder's undo history; undo/redo affects map edits and funds while preserving the current simulation clock.

Construction effects continue to use the original editor timestamps. Simulation time does not redefine construction timing, budgets, or placement rules.

## Compatible browser saves

`src/simulation/citySave.ts` keeps the existing `tiny-city-imagine-save-v1` storage key and its top-level `size`, `roads`, `buildings`, and `funds` fields. New saves add `saveVersion: 2` and `simulation: WorldState`.

- Legacy maps load unchanged with a fresh paused simulation.
- New saves restore the world clock, fractional remainder, pause state, and seeded random state.
- Restored simulation layouts must match the editor map and contain no Phase 1 residents.
- A corrupt/mismatched optional simulation snapshot falls back to a fresh paused world while retaining a valid saved map.
- Malformed map data or unavailable storage falls back safely to the existing sample city.
- Save failures remain visible through the existing city notice. Advancing time or editing marks the Save button dirty.

Pending command queues and transient event output are not saved. The current UI does not enqueue citizen commands. Future command-driven UI should drain pending commands or retain a separate journal before saving, as described in the [public contracts](./contracts.md).

## Verification and CI

```sh
npm run typecheck
npm test
npm run test:simulation
npm run build
```

Frontend integration tests exercise the real simulation package with React controls, builder edits, planner commands, undo/redo, legacy/new saves, storage failure, and hidden-tab behavior. A separate test uses a real Pixi `Ticker` to verify millisecond advancement and listener teardown. UI tests replace the WebGL viewport while exercising its public callback boundary; browser smoke checks cover the actual renderer.

The GitHub Actions workflow runs these checks on pull requests targeting `main` and pushes to `main`. Its separate API job uses Python 3.12 and `uv sync --locked --extra dev`, then runs pytest with warnings treated as errors. All actions are pinned to release commit SHAs.

## API boundary

The minimal FastAPI service still exposes only `/health` and OpenAPI documentation. Its CORS defaults allow localhost/127.0.0.1 on port 5173 and can be configured with `TINY_CITY_CORS_ORIGINS`. The browser runs the simulation locally without requiring the API. World/command HTTP endpoints, AI, pathfinding, and persistence backends remain outside Phase 0.
