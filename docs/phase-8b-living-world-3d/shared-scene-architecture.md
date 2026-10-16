# Shared scene architecture

## One authority

The simulation (`@tiny-city/simulation`) decides everything that exists and happens: buildings, roads, stops, residents, routes, trips, vehicles, events, work and money. The Character View adds nothing to it and removes nothing from it. It never decides who is where or what anyone does. The renderer's only freedoms are presentation:

- interpolating between ticks;
- choosing a level of detail;
- offsetting a walker to the curb side of their heading;
- choosing which nearby entities to draw at all.

None of these ever writes back. The character is the one exception, and it moves only through the validated `player.walk` command (Phase 8A) and existing Life commands.

```
WorldState ──► sceneModel (pure) ──► CityScene.sync (diff)     ──► Three.js scene
    ▲                │               ResidentActors.sync           (drawn subset)
    │                └─────────────► VehicleActors.sync
    │                                interactionTarget ──► InspectPanel (view models)
    └── player.walk / Life commands (validated by the simulation)
```

## Layers

| Module | Role | Pure? |
|---|---|---|
| `src/immersive/world/sceneModel.ts` | `staticSceneOf`, `diffStatic`, `actorScene`, `drawableVehicles`, `interactionTarget`, `stopFootprint` / `stopObstacles`, `stopSlot` | yes |
| `src/immersive/three/cityScene.ts` | The whole city as an incrementally reconciled scene (buildings, roads, stops, landscaping, sky and light, levels of detail) | no (GPU) |
| `src/immersive/three/actors.ts` | `ResidentActors`, `VehicleActors`, `walkerOffset`, `ACTOR_LIMITS` | no (GPU) |
| `src/immersive/InspectPanel.tsx` | Inspection of the E target through existing view models | React |
| `src/immersive/three/engine.ts` | Renderer, frame loop, input, collision grid, debug API | no |

The scene model reuses the City View's own rules rather than copying them:

- `roadMask` and `selectDecorAsset` (`artManifest`);
- `planDecor` (landscaping);
- `crowdLayout` (venue spots);
- `stopSide` (now in `vehicleMotion.ts`, re-exported by `transportLayer.ts`);
- `facingFor` / `roadSides` (8A spawn);
- `citizenLook` (resident looks);
- `vehiclePose` / `nextSample` (vehicle motion);
- `windowsOn` (night windows).

The 3D view and the City View therefore agree by construction.

## The frame

`engine.ts` runs one rAF loop while the Character View is open; the Pixi ticker is suspended (8A). Each frame:

1. `host.advance(elapsed)`: the one simulation clock advances. Pause, speed (1/2/4×), the 250 ms cap and hidden tabs are handled exactly as in the City View.
2. If `world.plan` or `world.transport.stops` changed identity, the collision grid is rebuilt at once. The scene reconciles in the background, in time slices (`slicer(4)`); a change landing mid-sync is picked up by the next one.
3. If the simulation moved the character (a city edit, a relocation, undo), it wins over local control.
4. The controller advances, and `player.walk` commits.
5. `actorScene(world)` is computed once. `ResidentActors.sync` and `VehicleActors.sync` reconcile the drawn subset around the character.
6. `cityScene.update`: sky and light from the minute of day, window levels, distance levels every 200 ms.
7. The E target is computed from the same entities. The frame is rendered.

Debug timing splits the frame into `simMs`, `syncMs` and `renderMs`.

## Keeping the scene between visits

The `CityScene` is kept in a module-level cache when you return to the City View. Its GPU resources are released (`releaseGpuResources`, which also disposes instanced meshes), but its entity bookkeeping is kept. The next **Enter World** rebuilds GPU objects and reconciles against the current world. Re-entering takes about 0.3 s instead of 1.2–1.8 s ([performance.md](performance.md)). `releaseSceneCache()` drops it entirely.

## No duplicated work

- **Ticking.** The Character View never runs its own simulation. Speed buttons in its clock card call the same `setSpeed`.
- **Settlements, trips, events.** These happen inside `runTick`, once, whichever view is open. Switching views while paused leaves the serialized world byte-identical (e2e test 2).
- **Entities.** Every drawn resident or vehicle is keyed by its simulation ID, and a `Map` holds at most one model per ID. `addBuilding` removes any previous object with the same ID before adding: a StrictMode-cancelled sync can never leave two.
