# Entity reconciliation

## Stable identities

| Entity | Identity | Rebuild key (a different key means rebuild) |
|---|---|---|
| Building | `Building.id` (simulation) | type, position, footprint, facing, design model |
| Road tile | `x,y` | connection mask (16 masks) and plaza flag |
| Road geometry | chunk `⌊x/12⌋,⌊y/12⌋` | any tile in the chunk, or a neighbour whose mask changed |
| Bus stop | `BusStop.id` | tile and curb side |
| Landscaping | chunk | signature of the chunk's `planDecor` items (kind, variant, position, size) |
| Resident | `Citizen.id` | n/a (pose from state every frame) |
| Vehicle | `Vehicle.id` | model and colour |

`staticSceneOf(world, designs)` builds the static model, and `diffStatic(prev, next)` returns:

- buildings added, removed and changed;
- the road and decor chunks to rebuild;
- stops added, removed and changed;
- `empty`.

`prev = null` is hydration: everything is added.

## Hydration and incremental sync

`CityScene.sync` applies a diff:

- **Removed building:** its near group, mid group, massing instance slot, collision solid and window materials go. Nothing is left behind.
- **Added or changed building:** the model is built (or fetched from the asset cache) with its mid-level twin and a massing slot; a changed building is removed first.
- **Road chunk:** re-merged per material.
- **Decor chunk:** its instanced landscaping and lamp pools are rebuilt.
- **Stop:** the shelter mesh is added, moved or removed.

Stats record `reconciles` and `lastSync` (added / removed / changed / road chunks / decor chunks / stops / ms). In e2e test 2, building a park and then demolishing a building reports `lastSync` with exactly `added 1` and then `removed 1`. The entity counts match the saved world's plan after each step.

Work is sliced: the sync yields between items so a large edit never freezes the frame. The engine starts at most one sync at a time. After it finishes, the engine checks whether the world changed again meanwhile and schedules another.

## Collision follows at once

Walkable ground is rebuilt synchronously on the first frame that sees a new plan or stop list (`buildWalkGrid(plan, decor, stopObstacles)`):

- a removed road stops being walkable immediately;
- a new road is walkable immediately;
- a new building's lot is solid before its model has finished building.

There are no orphan colliders: building solids belong to the building entry and go with it. Bus shelters are solid for the character and the camera (`stopFootprint`, the same box for both, tested).

## Residents and vehicles

Actors are not diffed against a stored model. They are recomputed from the live state every frame (`actorScene`, `drawableVehicles`) and reconciled by ID:

- drawn entries whose ID is no longer wanted (gone from the simulation, out of range, now inside a building or on a bus) are removed;
- new IDs get a model from the pool or a new build (at most 3 per frame, 2 on low quality).

A resident's model is keyed by ID and built from `citizenLook(id)`, so the same person always looks the same, in 3D and in the City View. Nobody is drawn twice.

## City View ↔ Character View

Both views read the same `Simulation` through `useCitySimulation`. The City View's undo, redo, AI-approved batches and saves happen while the Character View is closed. Its edits arrive as a new `world.plan` on the next entry, and the kept scene reconciles. Inside the Character View, a world change from elsewhere (for example the clock settling a day) is just the next state. Saves made from the Character View's **Save** button are ordinary saves of the authoritative world (e2e test 2: save, reload, and the plan, the character and the 3D entities match).
