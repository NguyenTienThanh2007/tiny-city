# Phase 4A Life Simulation contracts

Phase 4A adds one user-controlled character to the existing `@tiny-city/simulation` world. It reuses the
simulation's single clock, revision counter, road graph, navigator, occupancy rules and serialization. There is no
second world, clock, timer or store. Everything below is implemented in `packages/simulation/src/player.ts` and
covered by `packages/simulation/tests/player.test.ts`.

## Schema and compatibility

- `WorldState.schemaVersion` stays `2`. Phase 4 adds an optional `WorldState.player` (`PlayerCharacter`, `version: 1`).
- Worlds and saves without `player` behave exactly as before.
- A player is created only by the explicit `player.create` command. Loading a save, enabling residents, undo/redo and AI
  plans never create one.
- `serializeWorld` / `deserializeWorld` include the player. `validateWorld` validates it, so corrupt player data
  rejects the whole simulation snapshot. The frontend save loader then falls back to the city layout, as it does for
  other corrupt simulation data.
- No migration is needed: the field is additive and optional. Phase 3 saves load unchanged (tested in
  `src/simulation/citySave.test.ts` and `e2e/life-mode.spec.ts`).
- The AI Architect fingerprint (`cityFingerprint`) covers only plan, budget, revision and building ID cursor.
  Player progress never makes an AI preview stale, and the player is not sent as planning context beyond the
  existing world payload.

## `PlayerCharacter`

| Field | Contract |
| --- | --- |
| `version` | `1` |
| `id` | Always `player-1`. Kept separate from `npc-N` resident IDs. |
| `name` | NFC-normalized, trimmed, 1–24 characters. Must start with a letter or digit. May contain letters (including Vietnamese diacritics), digits, spaces, `'`, `.` and `-`. No double spaces, markup or control characters. |
| `appearance` | `PlayerAppearance` (below). Exactly six keys. |
| `homeBuildingId` | A `home`-kind building, or `null` after the home was demolished. |
| `position` | Fractional tile position inside the plan. |
| `movement` | `PlayerMovement` (below). |
| `activity` | `PlayerActivity` (below). |
| `needs` | `PlayerNeeds`: `energy`, `hunger`, `social`, `mood`, each in `[0, 100]`, rounded to 1e-4. 100 means fully satisfied. |
| `acquaintances` | Resident IDs met through greet/socialize. Oldest first, unique, at most 64, pruned when residents leave. |
| `createdTick` | Tick of creation, ≤ the current tick. |
| `lastOutcome` | The most recent `PlayerOutcome`, or `null`. |

### Appearance (typed and bounded)

`skinTone` 0–5, `hairColor` 0–7 and `outfitColor` 0–9 are palette indices; the renderer owns the palettes.

| Key | Values |
| --- | --- |
| `hairStyle` | `short`, `long`, `bun`, `curly`, `cap`, `buzz` |
| `outfit` | `tee`, `dress`, `jacket`, `overalls`, `hoodie` |
| `accessory` | `none`, `glasses`, `backpack`, `scarf`, `sunhat` |

The engine stores no colors, CSS, URLs or asset paths. Any other key, value or index rejects with
`invalid-appearance`. The options are exported as `PLAYER_APPEARANCE_OPTIONS`.

### Movement

`status` is one of:
- `inside`: in the player's home or a public venue (park, pool, clubhouse).
- `travelling`: following a route.
- `standing`: stopped on a road, or on the entrance leg of `currentBuildingId`.

Other fields:
- `heading`: a unit tile heading.
- `currentBuildingId`, `destinationBuildingId`.
- `route` (immutable points), `nextWaypoint`.
- `plannedRevision`: −1 requests a re-route on the next tick.

Travelling routes are validated like resident routes:
- orthogonal legs only;
- only road tiles, the source footprint, or the destination footprint;
- the destination building must be the player's home or a public venue.

### Activity

`PlayerActivity` fields:
- `kind`: `idle`, `move`, `rest`, `eat`, `visit`, `greet`, `socialize`.
- `phase`: `idle`, `travelling`, `performing`.
- `buildingId`, `citizenId`, `tile`.
- `durationMinutes`: fixed per kind; 0 for `idle` and `move`.
- `elapsedMinutes`.

`PlayerOutcome` records `kind`, `result` (`completed`, `cancelled`, `failed`), `reason` and `tick`, plus
`buildingId`, `citizenId` and `elapsedMinutes`.

Failure reasons: `unreachable`, `home-lost`, `venue-removed`, `venue-full`, `citizen-left`, `citizen-unavailable`,
`too-tired`, `route-lost`.

## Commands

`Simulation.executeLife(command)` applies a `LifeCommand` immediately, like `execute` for city commands, and returns
`LifeCommandResult` (`applied`, `reason`, `state`, `events`). Walking and activities then progress only on fixed
simulation ticks. A rejected command changes nothing and emits one `player.command-rejected` event. The pure reducer
is exported as `applyLifeCommand(world, command, navigator)`.

| Command | Effect | Rejections |
| --- | --- | --- |
| `player.create {name, appearance, homeBuildingId}` | Spawns inside the home, idle, with initial needs | `player-exists`, `invalid-name`, `invalid-appearance`, `home-not-found`, `not-a-home`, `home-full` |
| `player.customize {name, appearance}` | Renames or restyles the character | `player-not-found`, `invalid-name`, `invalid-appearance` |
| `player.move-in {homeBuildingId}` | Moving day: an explicit relocation inside the new home that cancels the current activity | `player-not-found`, `home-not-found`, `not-a-home`, `already-home`, `home-full` |
| `player.move-to {destination}` | `tile` (a road tile) or `building`. Enters only the player's own home; otherwise stops on the building's curb. A building tile is treated as that building. | `invalid-destination` (grass, water, out of bounds), `building-not-found`, `unreachable`, `stranded`, `invalid-command` |
| `player.start-activity {activity, buildingId?, citizenId?}` | `rest`/`eat` travel home first. `visit` picks the given venue or the nearest reachable one with space. `greet`/`socialize` approach a resident. | `no-home`, `not-leisure`, `no-venue`, `venue-full`, `building-not-found`, `citizen-not-found`, `citizen-unavailable`, `too-tired`, `unreachable`, `stranded` |
| `player.cancel` | Ends the current activity as `cancelled` and stops in place | `nothing-to-cancel` |

A new move or activity replaces the current one: the old one ends as `cancelled` first. If the new command is
rejected, the current activity continues untouched.

`playerHomeOptions(world)` lists every home with real `residents`, `capacity`, `available`, `roadConnected` and
`current`. `playerActionAvailability(world, navigator, citizenId?)` dry-runs each action through the same reducer, so
the HUD shows the engine's own reasons.

## Residency rules

- The player occupies **one housing slot** in their home.
- `player.create` and `player.move-in` require `residents < capacity`. Residents are never evicted to make room.
- `reconcilePopulation` treats the player's home as `capacity − 1` for residents, so the slot is never filled, even
  when residents are welcomed after the player moved in. `validateWorld` enforces `residents + 1 ≤ capacity`.
- If the home is demolished:
  - `homeBuildingId` becomes `null` (`player.home-lost`);
  - a player inside is relocated to the nearest road tile within 8 tiles (`player.relocated`, `building-removed`);
  - a rest or meal there fails with `home-lost`.
  - The player then picks a new home with `player.move-in`.
- If the home is moved while the player is inside, the player follows it (`player.relocated`, `building-moved`).

## Navigation

- The player uses the shared `RoadNavigator`: the same BFS, 4096-node limit, per-plan cache and orthogonal entrance
  legs as residents.
- `RoadNavigator.routeToRoad(position, currentBuildingId, goals)` was added for clicked tiles and building curbs.
  `nearestRoad(position, radius)` was added for recovery. Resident routing is unchanged; all Phase 3 NPC tests pass.
- At most one route search per tick for the player.
- Any structural city edit (including undo/redo and AI batches) invalidates the route. The player stops where they
  are and re-routes on the next tick; an unreachable result fails the activity with `unreachable`
  (`player.route-blocked`).
- If the road under a standing player is removed, they are relocated to the nearest curb. With no road within 8
  tiles they are `stranded`: moves reject with `stranded`, and moving in recovers.
- Walking speed is 0.45 tiles per game minute (×0.6 when exhausted). Positions come only from simulation ticks.
  Pause stops movement, and 2×/4× scale the elapsed time fed to the same clock.

## Needs and balance (per game minute)

All values are in `PLAYER_BALANCE` for tuning.

| Rule | Value |
| --- | --- |
| Base decay | energy −0.045, hunger −0.055, social −0.04 (an idle game day costs about 65 / 79 / 58) |
| Walking | energy −0.02 extra |
| Starving (hunger < 15) | energy decay ×1.5 |
| Exhausted (energy < 15) | walking ×0.6; `visit`, `greet`, `socialize` reject with `too-tired` |
| Mood | moves at 0.25/min toward avg(energy, hunger, social) + activity bonus − 10 per critical need |
| Levels | `critical` < 15 ≤ `low` < 30 ≤ `fair` < 60 ≤ `good`; each crossing emits `player.need-changed` |
| Initial | energy 85, hunger 75, social 60, mood 75 |

| Activity | Where | Duration | Effect while performing |
| --- | --- | --- | --- |
| `rest` | Inside own home | 120 min | energy +0.6, hunger decay halved, mood bonus +5 |
| `eat` | Inside own home | 30 min | hunger +2.5, mood bonus +5 |
| `visit` | Inside a park, pool or clubhouse with space | 60 min | social +0.15 (+0.05 per resident visitor, max +0.3), mood bonus +20 |
| `greet` | Within 2.5 tiles of a resident, or in the same venue | 5 min | social +1.2, mood bonus +10 |
| `socialize` | Same as greet | 30 min | social +1.8 (×0.75 when mood is critical), mood bonus +15 |

Effects accrue every tick of the performing phase. A cancelled or interrupted activity keeps what was gained, and
nothing changes instantly. Needs progress only on ticks, so pausing freezes them, and 1×, 2× and 4× give identical
results for the same game time (tested).

There is no health, disease or mortality. The consequences of low needs are the action limits and the mood penalty
above.

## Resident interactions

- The player can meet a resident who is:
  - on the street: the player walks to their tile and starts when within 2.5 tiles;
  - inside a public venue: the player enters the venue.
- Residents inside homes or workplaces are `citizen-unavailable`.
- The player re-routes when an approached resident drifts more than 3 tiles from the route goal.
- A conversation ends when the resident walks beyond 3.5 tiles or goes indoors. The outcome is `failed` with
  `citizen-left`, and gains so far are kept.
- Residents are never frozen, teleported or rescheduled by the player.
- `player.interaction` carries `citizenId`, `kind`, `firstMeeting` and a deterministic `topic`:
  - `introduction` on a first meeting;
  - otherwise `commute`, `leisure`, `rest` or `neighbourhood`, depending on the resident's real activity.
- No RNG state is consumed, and no Gemini call is made. The frontend phrases topics with real names and places.

## Events

All events carry `tick` and the literal `type`.

| Event | Payload |
| --- | --- |
| `player.created` | `player` |
| `player.customized` | `name` |
| `player.moved-in` | `homeBuildingId`, `previousHomeBuildingId` |
| `player.home-lost` | `buildingId` |
| `player.relocated` | `position`, `reason` (`building-removed`, `building-moved`, `road-removed`), `stranded` |
| `player.route-blocked` | `reason` (`unreachable`, `search-limit`) |
| `player.arrived` | `buildingId` (entered building or `null`), `position` |
| `player.activity-started` | `activity`, `phase`, `buildingId`, `citizenId` |
| `player.activity-ended` | `outcome` |
| `player.interaction` | `citizenId`, `kind`, `topic`, `firstMeeting` |
| `player.need-changed` | `need`, `level`, `previous`, `value` |
| `player.command-rejected` | `commandType`, `reason` |

## City edits, history and AI previews

- `applyCityCommand` runs `reconcilePopulation` and then `reconcilePlayer`. `Simulation.restoreCity` (undo/redo) and
  `enablePopulation` do the same.
- `reconcilePlayer` clears dangling home, venue and resident references, prunes acquaintances, invalidates routes,
  and relocates only when the ground under the player vanished.
- `CitySnapshot` does not include the player. Undo/redo never rewinds the player's identity, needs, position or
  activity. If an undo removes the player's home, the player loses it exactly as with demolition. Redoing the
  building restores the building, not the residency: the player moves back in through home selection.
- AI previews use the pure batch reducer, so they never mutate live player state (tested). Approved plans are one
  atomic batch with the same reconciliation.
