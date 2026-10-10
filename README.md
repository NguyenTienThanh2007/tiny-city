# TINY CITY: Imagine. Build. Live.

A frontend prototype for the Architect Mode milestone. The map renderer uses React, Vite, TypeScript, and PixiJS 8. All first-pass roads and buildings are drawn from vector shapes in PixiJS, so the scene does not depend on downloaded art assets.

## Start the Phase 1 baseline

Use Node.js 22.12+ (CI uses Node 24). The frontend and simulation are npm workspaces sharing the root lockfile.

```sh
npm ci
npm run dev
```

## Controls

- Choose Select, Road, Move, Bulldoze, or one of the nine building tools from the left toolbar. The rail scrolls on shorter screens.
- Click or drag to paint road tiles. Click a building tool, then an empty lot to place it. Select a building to inspect it.
- Click the minimap to navigate; Center city returns to the saved neighborhood. Use the mouse wheel to zoom. Hold Shift and drag, or use the middle mouse button, to pan.
- Press `V` (Select), `R` (Road), `M` (Move), `1`–`9` (buildings), or `X` (Bulldoze) to switch tools. Press Escape to return to Select.
- Use the prompt bar for the local planner demo (`build 3 villas`, `add a park`, `xây 3 biệt thự`, or `thêm 5 đường`). It places up to 12 buildings per command.
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

## Prototype boundary

The prompt bar remains a local phrase parser. Phase 1 makes `@tiny-city/simulation` authoritative for city commands, footprints, roads, construction spending, IDs, and deterministic saves. Pixi remains the single frame driver; only styles and construction timestamps remain presentation metadata. The existing UI and controls are preserved. No Gemini, NPC pathfinding, traffic, recurring economy, Life Mode, or God Mode is implemented. See [Phase 1A contracts](docs/simulation/phase-1a.md), [Phase 1B tools](docs/simulation/phase-1b.md), and the [final acceptance audit](docs/simulation/phase-1-acceptance.md).
