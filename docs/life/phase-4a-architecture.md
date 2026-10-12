# Phase 4A Life Simulation architecture

Phase 4A extends the existing engine without creating a second world, clock or store. The player is one optional
field on the authoritative `WorldState`. It is advanced by the same fixed step that moves residents and is
reconciled by the same reducers that apply city edits.

```
React UI ──executeLife(LifeCommand)──▶ Simulation ──applyLifeCommand──▶ WorldState.player
   ▲                                       │
   │  publish (events + snapshot)          ├─ runTick: residents (advanceDailyLife) → player (advancePlayer)
   │                                       ├─ execute/executeBatch: applyCityCommand → reconcilePopulation → reconcilePlayer
   └──────── Pixi ticker reads getWorld()  └─ restoreCity (undo/redo), enablePopulation → same reconciliation
```

## Modules

| File | Responsibility |
| --- | --- |
| `packages/simulation/src/types.ts` | `PlayerCharacter`, `PlayerAppearance`, `PlayerNeeds`, `PlayerActivity`, `PlayerMovement`, `PlayerOutcome`, `LifeCommand`, `LifeCommandResult`, `LifeRejectionReason`, player events |
| `packages/simulation/src/player.ts` | Validation (`validatePlayer`), cloning, command reducer (`applyLifeCommand`), per-tick update (`advancePlayer`), structural reconciliation (`reconcilePlayer`), home options and action availability, balance constants |
| `packages/simulation/src/navigation.ts` | Adds `routeToRoad` (routes to road tiles or a building's curb) and `nearestRoad` (recovery). Uses the shared BFS, limits and cache; resident routing is untouched |
| `packages/simulation/src/population.ts` | `reconcilePopulation` treats the player's home as `capacity − 1`, so the player's room is never filled |
| `packages/simulation/src/cityCommands.ts` | Runs `reconcilePlayer` after population reconciliation, inside the same atomic (and pure, for previews) reducer |
| `packages/simulation/src/simulation.ts` | `executeLife`, `getPlayer`; calls `advancePlayer` after residents in `runTick`; reconciles in `restoreCity` |
| `packages/simulation/src/world.ts` | `validateWorld` calls `validatePlayer`; `cloneWorld` copies the player |

## Design decisions

- **Optional field, schema 2 unchanged.** Old saves and callers never see a player. This is the smallest compatible
  extension: no migration code, no new save envelope, and no change to Phase 2 proposal contracts or fingerprints.
- **Separate identity, shared mechanics.**
  - The player is not a `Citizen`. It has no schedule, workplace or `npc-N` ID, and resident counts and Live mode are
    unchanged.
  - It reuses the citizen concepts that already work: movement status, heading, route, `nextWaypoint`,
    `plannedRevision`, interior positions and entrance legs.
- **Immediate commands, ticked progress.** Like city commands, Life commands apply at once and report a typed
  rejection, so the UI gets instant feedback even while paused. Walking, activity progress and needs change only on
  fixed ticks, so pause, 1×/2×/4× and save/load behave like the rest of the simulation.
- **Occupancy rule.**
  - The player holds one housing slot. Creation and moving in require a free room.
  - Population reconciliation never fills that room, so residents are never evicted for the player.
  - An undo can restore residents into a home first; capacity is then enforced by the normal resident reassignment
    rules.
- **Recovery is explicit.**
  - Ordinary movement never teleports. Only three discontinuities relocate the player, each emitting
    `player.relocated`:
    - the building the player is inside was demolished or moved;
    - the road under a standing player was removed;
    - moving day (`player.move-in`).
  - With no road within 8 tiles, the player is `stranded` and can recover by moving into a home.
- **No resident mutation.** Interactions read residents' positions and states and never write them. A conversation
  ends honestly when the resident walks away on their own schedule.
- **Determinism.**
  - No `Math.random`, wall clock or RNG consumption: interaction topics come from the resident's state.
  - Needs are rounded to 1e-4 after each tick, so serialized saves are stable and replays match exactly (tested).

## Per-tick algorithm (`advancePlayer`)

1. If the activity targets a resident who left, it fails with `citizen-left`.
2. **Travelling:**
   - A social activity whose resident is already in range switches to performing.
   - Otherwise the player re-routes when needed. A route is needed when there is no route, the city revision changed,
     or a moving resident drifted more than 3 tiles from the route goal. One search per tick at most.
   - Then the player walks `0.45 × minutesPerTick` tiles (×0.6 when exhausted) along orthogonal legs.
   - On arrival the player enters the home or venue, or stands on the curb, then performs or completes.
3. **Performing:** the player checks the venue or resident is still valid, adds the elapsed minutes and completes at
   the fixed duration.
4. **Needs:** apply decay or activity effects and move mood toward its target. Emit level-change events.

All work is O(1) except reading the resident list for the approached resident and venue visitor counts
(O(residents)), at most once per tick.

## Reconciliation (`reconcilePlayer`)

Runs after every structural change, including AI-approved batches and undo/redo. It handles three things.

- **References:**
  - clears a removed home (`player.home-lost`);
  - prunes acquaintances who left;
  - fails activities whose home, venue or resident disappeared.
- **Routes:** any plan change marks the route stale, and the player re-routes on the next tick from where they stand.
- **Ground:**
  - relocates the player out of a removed building, or off a removed road tile;
  - follows a moved building when inside it.

Previews call the same pure reducer, so an AI preview can show the consequences without mutating live state.

## Performance

Measured with `node scripts/life_benchmark.mjs`; results in `docs/life/benchmark-results.json`. Each row is the
same commuting city with and without a player who keeps walking the whole street.

| Residents | Mean tick (no player) | Mean tick (player) | p95 (no player / player) |
| --- | --- | --- | --- |
| 100 | 0.082 ms | 0.081 ms | 0.165 / 0.178 ms |
| 1000 | 0.920 ms | 0.846 ms | 1.537 / 1.202 ms |
| 3000 | 2.672 ms | 2.664 ms | 3.545 / 3.554 ms |

The player's cost is within run-to-run noise. Serialized size grows by about 1 KB plus the active route.
Browser rendering measurements are in `docs/life/phase-4-complete-acceptance.md`.

## Undo/redo semantics

- City history (`CitySnapshot`) does not include the player. Undo and redo never rewind identity, appearance, needs,
  position, activity or diary.
- Moving home and customizing are Life actions, not city edits, so they are not on the undo stack.
- If an undo or redo removes the player's home or venue, it is reconciled exactly like a demolition.
