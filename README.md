# TINY CITY: Imagine. Build. Live.

A frontend prototype for the Architect Mode milestone. The map renderer uses React, Vite, TypeScript, and PixiJS 8. All first-pass roads and buildings are drawn from vector shapes in PixiJS, so the scene does not depend on downloaded art assets.

## Start the prototype

```sh
npm install
npm run dev
```

## Controls

- Choose Select, Road, Villa, Park, Clubhouse, or Bulldoze from the left toolbar.
- Click or drag to paint road tiles. Click a building tool, then an empty lot to place it. Select a building to inspect it.
- Use the mouse wheel to zoom. Hold Shift and drag, or use the middle mouse button, to pan.
- Press `V`, `R`, `1`, `2`, `3`, or `X` to switch tools. Press Escape to return to Select.
- Use the prompt bar for the local planner demo (`build 3 villas`, `add a park`, `xây 3 biệt thự`, or `thêm 5 đường`). It places up to 12 buildings per command.
- Building and road placement uses the funds shown in the HUD; the sample starts with $24,680.
- Save writes the current map to this browser. The saved map loads automatically next time.
- Undo restores the previous map edit.

## Prototype boundary

The prompt bar uses a small local phrase parser to demonstrate the build flow. It does not call an AI service or return a structured CityPlan yet. Life Mode, God Mode, simulation time, traffic, and resident schedules are represented in the interface but need the simulation package and a planner service before they can run. The local map state is intentionally small and can be adapted to the shared `WorldState` / `CityPlan` types once Person 1 publishes that contract.
