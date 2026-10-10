# Phase 1 frontend integration

The React/PixiJS builder consumes public simulation ESM exports. Phase 1A makes the engine authoritative for layout, roads, budgets, and IDs. The root lockfile still owns the integrated dependency graph. [Contract coordination](./phase-1a.md) documents schema 2 and placement/history policies. No duplicate shared/Python model, Gemini, NPC pathfinding, or unrelated phase is included.

## Install and run

Use Node.js 22.12+ (CI uses Node 24). From the repository root:

```sh
npm ci
npm run dev
```

Development, frontend build, and frontend integration tests automatically build the simulation package first. To rebuild its exports directly, run `npm run build:simulation`. The current integration imports production exports, so later simulation source changes must be rebuilt before the frontend can consume them.

## Contract boundary

`src/simulation/cityAdapter.ts` imports initial/legacy editor data once. Thereafter `projectCity` derives compatibility map fields from the engine. Only construction timestamps remain editor metadata. Existing visual kinds and drawing behavior stay intact.

| Editor building | Simulation kind | Footprint | Capacity metadata |
| --- | --- | --- | --- |
| Villa | `home` | 2 × 2 tiles | 2 |
| Park | `park` | 4 × 4 tiles | 20 |
| Clubhouse | `workplace` | 3 × 3 tiles | 20 |

IDs, names, and tile coordinates survive import. Roads come from `world.plan.roads`, funds from `world.budget.balance`. Hover previews call the public placement validators; prices and footprints come from the immutable catalog. Drawing functions, isometric projection, construction timing, tools, pan, and zoom remain intact.

Every builder mutation submits structured `CityCommand` payloads through `executeBatch`. Planner scans preview the same reducer and commit one atomic batch, producing a single undo entry for a multi-building/road plan. History entries capture engine `CitySnapshot` data and compatibility metadata; undo/redo calls `restoreCity`. Time, RNG, and queues stay current; IDs retain their high-water mark. Structural changes no longer use `replacePlan`. The editor still creates no residents.

## Clock and event flow

`src/simulation/useCitySimulation.ts` owns one simulation runner for the mounted editor. The world starts paused at day 0, midnight; the UI displays this as DAY 01. Defaults remain 100 real milliseconds per tick and one game minute per tick.

`src/simulation/tickerAdapter.ts` connects the existing [Pixi ticker](https://pixijs.com/8.x/guides/components/ticker) to the hook using `ticker.deltaMS`, and removes that listener during viewport teardown. Pixi is the only frame driver; React does not create a second simulation timer.

The hook ignores hidden-tab frames and caps submitted frame deltas at 250 ms to avoid long resume catch-up bursts. Pixi's own delta cap also applies. Fractional time remains in the runner and is included in saves even between published UI ticks. The UI publishes snapshots on executed ticks or explicit controls/edits, without rerendering for every fractional frame.

Resume/Pause toggles the runner, and Step executes exactly one tick while paused. The inspector displays game day/time and the latest typed event; the same controls remain visible over the map when the narrow-screen layout hides the inspector. Non-tick events such as `clock.day-started` take precedence within a batch. Time edits do not enter the builder's undo history; undo/redo affects map edits and funds while preserving the current simulation clock.

Construction effects continue to use the original editor timestamps. Simulation time does not redefine construction timing, budgets, or placement rules.

## Compatible browser saves

`src/simulation/citySave.ts` keeps the original storage key and top-level map fields. New saves use `saveVersion: 3` with a deterministically serialized schema-2 world as authority.

- Legacy maps load with a fresh paused world and their current funds as the opening budget.
- Phase 0 v2 envelopes migrate schema-1 clocks, RNG, roads, and timestamps using editor context.
- New saves restore the complete ledger, revision, ID cursor, clock remainder, pause state, and RNG. A valid schema-2 snapshot wins over stale top-level roads/funds.
- The browser adapter remains scoped to the existing 64×64 catalog city without residents; the standalone engine supports generic snapshots independently.
- Corrupt optional snapshots recover a valid compatibility map and remaining funds with a fresh world; historical spending cannot be recovered from corrupted data.
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

Frontend integration tests exercise the real simulation package with React controls, builder edits, planner commands, undo/redo, legacy/new saves, storage failure, and hidden-tab behavior. A separate test uses a real Pixi `Ticker` to verify millisecond advancement and listener teardown. UI tests replace the WebGL viewport while exercising its public callback boundary; Chromium acceptance tests use the production build via `vite preview` and drive real Pixi pointer events for all nine catalog buildings, construction completion, moving, history, save/reload, road gestures, camera/minimap transforms, resizing and narrow screens. Run `npx playwright install chromium` then `npm run test:e2e`.

The GitHub Actions workflow runs these checks on pull requests targeting `main` and pushes to `main`. Its gameplay job installs Chromium and runs the acceptance suite. Failed browser tests retain a screenshot and trace under `test-results/` (inspect with `npx playwright show-trace <trace.zip>`). Its separate API job uses Python 3.12 and `uv sync --locked --extra dev`, then runs pytest with warnings treated as errors. All actions are pinned to release commit SHAs.

## API boundary

The FastAPI scaffold still exposes only health/OpenAPI documentation. The browser runs the simulation locally. World/command HTTP endpoints, Gemini, NPC pathfinding, and persistence backends remain outside Phase 1A.


## Acceptance contract additions

`CONSTRUCTION_COSTS` now includes every `BuildingType` as well as `road`; prices and footprints are unchanged. No WorldState schema, command, or event shape changed. `LoadedCity.notice?` reports recovery when simulation data or the save envelope cannot be restored; recovery never writes storage automatically. A valid canonical save remains authoritative. Future envelope versions are not interpreted as legacy maps, and future construction timestamps are clamped to the load time to avoid unbounded animation/timer delays.

The viewport's optional `CameraRequest` and gesture callbacks are presentation interfaces. Pixi's stage must remain interactive; decorative world layers do not receive pointer events. The camera and minimap use the same transform, and the host resize observer resizes Pixi before publishing camera corners. Previews refresh when commands, tools or camera state change, even with a stationary cursor. Leaving the canvas ends gestures and removes the ghost. Undo/redo cancels pending moves while restoring validated simulation snapshots.
