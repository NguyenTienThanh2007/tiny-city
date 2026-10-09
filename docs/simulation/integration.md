# Developer B integration with PixiJS

The package is independent of PixiJS. Developer B owns the adapter that maps snapshots into render objects and supplies elapsed milliseconds. All contracts currently live inside the simulation package; review them together before moving definitions into a shared package or creating API world endpoints.

## Register the package

Build the simulation from the repository root:

```sh
npm --prefix packages/simulation ci
npm --prefix packages/simulation run build
```

Once Developer B has created `apps/web`, B can add `"@tiny-city/simulation": "file:../../packages/simulation"` to its dependencies, or register the package in the team's chosen workspace configuration. These frontend/root edits have not been made by Developer A. Rebuild the simulation after source changes, because imports resolve to `dist`.

The root export provides the runtime and types; the separate `/fixtures` export keeps example data optional.

## Frame adapter

```ts
import { Simulation } from '@tiny-city/simulation';
import type { SimulationEvent, WorldState } from '@tiny-city/simulation';
import { createDemoWorldFixture } from '@tiny-city/simulation/fixtures';

const simulation = new Simulation(createDemoWorldFixture({ seed: 'preview-city' }));

// Implement these functions in the renderer/UI layer.
declare function renderWorld(state: WorldState, alpha: number): void;
declare function handleEvent(event: SimulationEvent): void;

renderWorld(simulation.getState(), 0);

export function onFrame(elapsedMs: number): void {
  const result = simulation.advance(elapsedMs);
  renderWorld(result.state, result.alpha);
  for (const event of result.events) handleEvent(event);
}
```

Wire `onFrame` to the Pixi ticker's elapsed-millisecond value, not its dimensionless frame multiplier. Do not create a second simulation timer or multiply elapsed time by `minutesPerTick`: the core handles game-time scaling. For tab suspension, the frontend may pause the runner or choose an explicit elapsed-time cap. Replay should use `step` and tick-indexed commands rather than frame timing.

Keep building sprites in a map keyed by `building.id`, and citizen sprites keyed by `citizen.id`. Draw the static layout from `state.plan.buildings`. Map tile coordinates to your orthogonal/isometric projection in the renderer. Citizen positions can be fractional. Footprints are tile sizes; they are not sprite pixel dimensions.

Read `activity` and `targetBuildingId` to label or animate citizens. Phase 0 schedule changes do not cause movement; citizen positions stay fixed unless a relocation command is sent. Treat `alpha` as a presentation fraction only. Future movement interpolation will require retaining previous/current snapshots; do not mutate either snapshot for animation.

## Fixtures and interaction

| Export | Contents |
| --- | --- |
| `EXAMPLE_CITY_PLAN` | A 24×18 layout with three homes, two workplaces, and one park |
| `createDemoWorldFixture({ seed?, clock? })` | Four named citizens, repeating schedules, stable IDs, seed-dependent initial positions |
| `createEmptyWorldFixture({ clock? })` | A 24×18 empty plan with no buildings or citizens |

Defaults are day 0 at midnight, 100 real milliseconds per tick, and one game minute per tick. Fixture factories return fresh immutable snapshots. Calling the demo factory with the same seed reproduces the same world.

To demonstrate a manual move:

```ts
simulation.enqueue({
  type: 'citizen.relocate',
  citizenId: 'citizen-1',
  position: { x: 8.5, y: 7.5 },
});
// Applied on the next whole tick; handle command.applied / command.rejected.
```

For a static preview use `simulation.pause()`. For deterministic inspection call `simulation.step()`. Resume with `simulation.resume()`.

## API scaffold

The frontend can check `GET http://127.0.0.1:8000/health`:

```json
{ "status": "ok", "service": "tiny-city-api", "phase": 0 }
```

CORS defaults to `http://localhost:5173` and `http://127.0.0.1:5173`; configure `TINY_CITY_CORS_ORIGINS` for a different development origin. There are no AI, world, or command HTTP endpoints in Phase 0. The renderer runs the TypeScript simulation locally without requiring the API.

## Coordination points

Before shared-contract changes, agree on coordinate/projection conventions, building/activity enum extensions, snapshot schema versioning, and any future transport protocol. Names and shapes in this handoff are the package-local Phase 0 proposal. Coordinate changes with Developer A; avoid maintaining a duplicate interface set in the renderer.
