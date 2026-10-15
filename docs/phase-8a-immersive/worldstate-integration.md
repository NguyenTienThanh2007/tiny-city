# WorldState integration

## Authority

The simulation stays authoritative. The Character View never writes to the world from its render loop. It proposes positions and commits them as commands, and the simulation validates each one or refuses it.

## `player.walk` (the one new command)

```ts
{ type: 'player.walk', position: Position }   // LifeCommand, applied at the current tick by Simulation.executeLife
```

Validation is `playerWalkCheck(world, nav, to)`, exported from `packages/simulation/src/player.ts`:

| Situation | Rule | Refusal |
|---|---|---|
| no player / not moved in | n/a | `player-not-found` / `not-placed` |
| target not finite or outside the plan | n/a | `invalid-destination` |
| player **inside** a building | the target must lie on one of that building's road access tiles (stepping out through the door) | `not-walkable` |
| otherwise | the step is at most 1 tile (`PLAYER_LIMITS.walkStep`), and **every tile the straight segment touches** is a road tile or the building the player is using (its entrance leg); exact grid traversal, and a segment through a tile corner counts both side tiles | `step-too-long` / `not-walkable` |

When a step is accepted:
- the position is stored, rounded to 1e-4 tiles;
- the player becomes `standing`;
- any route or activity ends as `cancelled`, exactly as choosing a new destination does;
- energy drops by the distance walked times the routed-walking rate (`walkingEnergy / walkingSpeed` per tile), with `player.need-changed` when a level is crossed.

Steps add no events and no history entries: walking is not a city edit, so undo/redo never rewinds it.

Life commands change only `world.player`, so `executeLife` validates and clones just the player and shares everything else by reference. The plan, citizens and indexes keep their identity: a step never rebuilds the road navigator, the transport network or the City View's buildings. An earlier version deep-cloned the whole world on every step and leaked about 1.8 MB per step through the suspended City View. A unit test now checks that every other part of the world keeps its identity.

### Replay semantics

A step is an ordinary Life command, applied at the tick it arrives. A command log replayed at the same ticks reproduces the same world byte for byte (unit test: "saves and replays exactly"). The 3D controller's continuous motion between commits is presentation; only committed steps exist in the world. The invariants fuzz (`tests/invariants.test.ts`) now mixes random `player.walk` steps into edits, batches, undo, save/load and ticks, some of them invalid; all must keep the world valid.

## The bridge (engine)

- **Before the first movement** the character is shown exactly as the simulation has them:
  - inside a building: at its door spawn, still indoors;
  - walking a click-to-move route: following the authoritative position, with the walk animation from real displacement;
  - standing on the street: right there.

  Entering the world never changes the world.
- **The first movement takes control.**
  - From inside, the door spawn is committed (stepping out through the door).
  - From a building's entrance leg, a few ≤ 0.9-tile steps reach the door.
  - From a route, the current position is committed, which stops the route.
- **While moving**, the engine commits a step:
  - before the straight segment from the last committed point to the next position would fail `playerWalkCheck` (the controller and the simulation run the same check);
  - at least every 0.5 tiles or every 250 ms;
  - when the character stops.

  In the 2-minute benchmark session: 487 commits, 0 refused.
- **If a step is refused** (it shouldn't be), the character snaps to the simulation's position and `rejected` counts it.
- **If the world moves the character** (a city edit relocates them, or anything else changes the authoritative position), the engine notices that it differs from the last commit, gives up control, and follows the simulation.
- **No movement while paused.** The paused clock stops input movement. Pause/Resume and Save are available in the HUD and with Space.

## Spawn (`src/immersive/spawn.ts`)

`resolveSpawn(world, nav, grid, rememberedYaw)`:

1. **On the street** (standing or walking on road): exactly the authoritative position, facing the remembered 3D yaw or the heading.
2. **In or at a building** (home or venue): the **door spawn**. This is on the sidewalk of a road access tile, 0.13 tiles outside the lot edge, facing the street. Tiles on the building's front side come first, then the stable tile order. If a lamp stands exactly there, the tile centre is used instead.
3. **Otherwise** the result is an explanation with a recovery path, never an invented position:
   - `no-character` → Create character;
   - `no-home` → Choose a home;
   - `stranded` (no street beside the character) → back to the city to connect a road.

The app runs `resolveSpawn` before mounting the 3D view, so a failure costs nothing.

## Enter World / Return to City

Entering:
1. Check for a touch-only device and the spawn (dialog if not possible).
2. Clear selections.
3. Lazily load the view; the City View's ticker stops.
4. Build the scene (progress card), compile shaders.
5. Place the character at the spawn, behind-the-back camera.
6. Controls on.

Returning:
1. Commit the last step.
2. Controls off; pointer lock released.
3. Dispose everything (see [hybrid-renderer-architecture.md](hybrid-renderer-architecture.md)).
4. Pixi ticker restarts.
5. The camera frames the character: Life View in Life Mode, Focus otherwise.

The last 3D yaw is remembered for the next entry.

## Save, load and cloud saves

There is nothing new to save: the position is `world.player.position`, already in every save (local and cloud) and validated on load. Save works from the Character View's HUD. Browser scenario L walks, saves, reloads the page, and re-enters at the same position. The viewer's 3D settings (sensitivity, invert, quality) live in browser storage only (`tiny-city-3d-settings-v1`), never in the world or the save. Legacy saves need no migration: a pre-Phase-5 save with a player enters with the classic models (scenario M).

## Residents and vehicles (a limited synchronized subset)

- **Residents** (`residents.ts`): up to 14 residents the simulation has outdoors (`travelling` or `waiting`) within 9 tiles. Each is drawn at its authoritative position (smoothed between ticks), with the look derived from its ID exactly as in the City View, walking by displacement. Residents indoors or in vehicles are not drawn.
- **Vehicles** (`vehicles.ts`): up to 24 simulated vehicles within 12 tiles, including residents' cars, vans and buses of real lines, parked or driving. They use the City View's pure pose (`vehiclePose`: front distance interpolated between ticks, kept to the right lane) and the Phase 6 vehicle models with their colour rule (`vehicleColor`, now shared from `vehicleMotion.ts`).

Nothing drives or walks that the simulation does not have. Residents and vehicles are not solid, and there is no 3D interaction with them yet (Phase 8C). Venue crowds, bus stops and residents inside parks are drawn only in the City View (Phase 8B).
