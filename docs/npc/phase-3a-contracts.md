# Phase 3A public contract and coordination

This extends `@tiny-city/simulation`; it does not introduce another world, clock or citizen model. Developer B should use these public exports and the integration examples before adding visuals. No Phase 3B visual implementation is included.

Schema 2 remains valid. Optional `WorldState.population` version 1 activates managed living-world behavior. `createWorld({…, population: {maxCitizens: 1000}})` or `Simulation.enablePopulation()` explicitly enables it. Old saves and callers without this field retain Phase 0–2 authored-schedule behavior. Enabling migrates existing residents, consumes only the saved RNG and fills housing deterministically. Default cap is 1000; hard cap is 10000. No wall-clock or LLM calls are used.

`Citizen.id`, name, position, home/work references and schedule remain authoritative. Managed residents add `attributes` (age, tiles/game-minute walkingSpeed, scheduleOffset), `scheduleMode` and `movement`. Movement exposes status, unit heading, current/destination building IDs, arrival activity, immutable route points, nextWaypoint and plannedRevision. `activity: 'travel'` is emitted only while progressively following a route; waiting uses idle. Interior occupants are exposed by currentBuildingId so a renderer can hide them.

Housing capacity is enforced separately from job and leisure capacities. Office/mall and untyped workplaces provide jobs; clubhouse/pool/park are leisure destinations. Residents keep valid homes/jobs before vacancies are filled in building-ID order. Housing loss first reassigns displaced residents, then removes residents who cannot be housed; there is no dangling or nullable home reference. IDs are monotonic `npc-N`, never recycled. All live citizens are adults with stable seeded attributes. Custom schedules survive reassignment with deleted references cleared safely.

Ordinary travel uses orthogonal road centers and explicit entrance legs inside only the source/destination footprint. Disconnected destinations idle until a city edit or routine change permits retry. Routes are invalidated on structural edits. A resident physically inside a moved building follows that building's interior position; this editor relocation is distinct from ordinary progressive travel. Road deletion under a traveller leaves them waiting at their current position; they resume only from a legal access point. No shortcut across vacant terrain or another building is invented.

`CitySnapshot.citizens` is optional and used for managed undo/redo identity restoration. Clock, RNG and citizen/building ID high-water marks never rewind. Restored residents retain current movement when the same identity still exists; restored/departed identities receive safe interior state and reconciled assignments. Old snapshots without citizens are reconciled against current residents. Pure city previews use the same population reducer as live commands; failed batches publish no NPC, RNG or ID changes.

Events add citizen.created, citizen.removed, citizen.assignment-changed, citizen.moved, citizen.arrived, citizen.route-blocked and population.changed. Existing event payloads and Phase 2 proposal contract version 1 stay unchanged. Structural edits increment city revision; NPC-only progression does not invalidate AI previews. Read the complete immutable snapshot after receiving events, rather than constructing a competing live NPC store.

| Public contract | Fields |
| --- | --- |
| `PopulationState` | `version: 1`, `maxCitizens`, `nextCitizenId` |
| `CitizenAttributes` | integer `age`, positive `walkingSpeed` in tiles/game-minute, integer `scheduleOffset` in minutes |
| `CitizenMovement` | `status: 'inside' \| 'travelling' \| 'waiting'`, `heading: Position`, nullable `currentBuildingId`/`destinationBuildingId`, `arrivalActivity`, `route: readonly Position[]`, `nextWaypoint`, `plannedRevision` |
| `BuildingOccupancy` | `buildingId`, readonly `residentIds`, `workerIds`, `visitorIds` (arrived leisure occupants) |
| `RouteResult` | `{route: readonly Position[], reason: null}` or `{route: null, reason: 'unreachable' \| 'search-limit'}` |
| `NavigationStats` | `searches`, `cacheHits`, `visitedNodes`; derived diagnostics excluded from saves |

All event payloads below also contain `tick` and the literal `type`. Fields remain readonly.

| Event | Payload |
| --- | --- |
| `citizen.created` | complete `citizen` (also emitted when undo restores an identity) |
| `citizen.removed` | `citizenId`, `reason: 'housing-lost' \| 'population-limit'` |
| `citizen.assignment-changed` | `citizenId`, `homeBuildingId`, nullable `workBuildingId` |
| `citizen.moved` | `citizenId`, authoritative `position`, `heading` |
| `citizen.arrived` | `citizenId`, `buildingId` |
| `citizen.route-blocked` | `citizenId`, `destinationBuildingId`, `reason: 'unreachable' \| 'search-limit'` |
| `population.changed` | `count` |
| existing `citizen.activity-changed` | `citizenId`, `activity`, nullable `targetBuildingId` (now supports `travel`) |

Routing is bounded to 16 requests per tick, 4096 road nodes per search, a 256-entry per-plan cache and the configured population cap. Managed clocks allow at most 1440 game minutes per tick to bound midnight events; legacy clock limits are unchanged. Queued requests retry in citizen array order. These deterministic limits are independent of cache warmth, so loading a save does not change routing decisions. No timers or animation-frame callbacks belong in the engine.
