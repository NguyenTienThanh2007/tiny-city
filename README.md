# TINY CITY: Imagine. Build. Live.

A frontend prototype for the Architect Mode milestone. The map renderer uses React, Vite, TypeScript, and PixiJS 8. All first-pass roads and buildings are drawn from vector shapes in PixiJS, so the scene does not depend on downloaded art assets.

## Start the Phase 0 baseline

Use Node.js 22.12+ (CI uses Node 24). The frontend and simulation are npm workspaces sharing the root lockfile.

```sh
npm ci
npm run dev
```

## Controls

- Choose Select, Road, Villa, Park, Clubhouse, or Bulldoze from the left toolbar.
- Click or drag to paint road tiles. Click a building tool, then an empty lot to place it. Select a building to inspect it.
- Use the mouse wheel to zoom. Hold Shift and drag, or use the middle mouse button, to pan.
- Press `V`, `R`, `1`, `2`, `3`, or `X` to switch tools. Press Escape to return to Select.
- Use the prompt bar for the local planner demo (`build 3 villas`, `add a park`, `xây 3 biệt thự`, or `thêm 5 đường`). It places up to 12 buildings per command.
- Building and road placement uses the funds shown in the HUD; the sample starts with $24,680.
- Resume/Pause controls the fixed-timestep simulation; Step advances one game minute while paused. The inspector shows the clock and latest simulation event.
- Save writes the map and simulation snapshot to this browser. Legacy map saves still load automatically.
- Undo/redo restores map edits without resetting the simulation clock.

## Verify

```sh
npm run typecheck
npm test
npm run test:simulation
npm run build
```

For API checks, run from `apps/api`:

```sh
uv sync --locked --extra dev
uv run --locked --extra dev python -m pytest -q -W error
```

GitHub Actions runs the same frontend, simulation, and API checks on pull requests to `main` and pushes to `main`. [Integration details](docs/simulation/integration.md) describe the adapter, clock driver, and save format.

## Prototype boundary

The prompt bar remains a local phrase parser. Editor layouts are mapped into the public `CityPlan` / `WorldState` contracts from `@tiny-city/simulation`. PixiJS is the single frame driver; the simulation clock and event outputs are live. Roads, funds, rendering styles, and construction timestamps remain editor metadata. Phase 0 creates no residents and adds no Gemini, pathfinding, traffic, economy, Life Mode, or God Mode features.
