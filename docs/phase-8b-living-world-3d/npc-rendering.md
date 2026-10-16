# Resident rendering

## Who is drawn

`actorScene(world, isRoad, stops)` classifies every citizen from their authoritative movement and trip:

| Mode | When | Where it is drawn |
|---|---|---|
| `walking` | on a road tile and travelling (Phase 3 route), or walking to a stop (Phase 6 trip phase `to-stop`) | the simulated position, offset to the sidewalk |
| `waiting` | on a road tile, Phase 3 `waiting` | the simulated position, offset to the sidewalk |
| `at-stop` | Phase 6 trip phase `waiting` at a known stop | `stopSlot` beside the shelter, on the shelter's curb half, five per row, sorted by ID |
| `at-venue` | a visitor present at an open-air venue | the City View's own `crowdLayout` spot, with its action (idle, talk, sit, cheer) |

Everyone else is hidden and counted in `hidden`:

- `inside`: in a building, or a visitor of an indoor venue.
- `onLot`: on a building's own entrance leg. These residents appear at the lot edge, never inside walls.
- `riding`: on a bus. This equals the sum of `passengers` on the buses, checked in e2e test 1.
- `driving`: in a car.

The unit tests `sceneModel.test.ts` check these invariants every 20 game minutes through a whole day (commutes, buses, outings, evenings): every resident is drawn at most once or counted once, and drawn ∪ hidden = all citizens. They also check that a rider is never drawn walking and that computing the scene never changes the world.

## How they look and move

- **Identity.** The model is the bake's rig built from `citizenLook(id)`: the City View's appearance for that resident. Each one is a single skinned mesh with vertex colours, built at rig detail 0.4 (`setRigDetail`; detail 1 keeps the bake byte-identical) and without a contact disc. One draw call each, about 3k triangles.
- **Interpolation.** The drawn position eases toward the authoritative one (τ = 90 ms). A jump of more than 1.5 tiles (a new venue spot, a stop slot) is taken at once, so nobody glides through buildings.
- **Sidewalks.** `walkerOffset(heading)` puts walkers 0.36 tiles to the right of their heading, on the sidewalk band, as vehicles keep to their lane. It is presentation only. Standing residents keep the side of their last heading.
- **Poses.** These come from the authoritative state, following the same rules as the City View's 3.0C poses:
  - walking by displacement;
  - idle while waiting or at stops;
  - venue visitors talk, sit or cheer (concert attendees cheer).
  - Each resident's idle cycle is de-synced by an ID hash.
- **Pause.** Paused, nobody moves and the animation clock stops.

## Budget and pooling

`ACTOR_LIMITS`:

| Quality | Radius (tiles) | Max drawn | Builds per frame |
|---|---|---|---|
| high | 26 | 60 | 3 |
| low | 18 | 30 | 2 |

The residents closest to the character are drawn, with ties broken by ID. Models leaving the set go to an LRU pool keyed by ID (up to the same limit), so walking back and forth does not rebuild anyone.

## Interaction

`interactionTarget(player, yaw, residents, buildings, stops)` picks what the character faces within an 80° cone:

| Target | Range |
|---|---|
| resident | 1.4 tiles |
| bus stop | 1.1 tiles |
| building (lot edge) | 0.75 tiles |

Residents win ties. The prompt names the target ("Talk to Nam 197", "Inspect Corner Café"). **E** opens `InspectPanel`:

- **Resident:** activity, destination, home, workplace, your relationship, and their friends (`describeCitizen`, `friendsOf`, `outingView`). Greet and Chat run the existing Life commands, which walk the character over and are validated by the simulation.
- **Building:** type, occupancy, opening hours and economic activity (`buildingEconomy`, `venueView`), plus Visit or Eat here where Life Mode allows it.
- **Bus stop:** lines, waiting residents and next buses (`stopView`).

Opening the panel changes nothing: e2e test 1 compares the serialized world before and after inspecting a resident, a stop and a building. Relationships change only through those Life commands.
