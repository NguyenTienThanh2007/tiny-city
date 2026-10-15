# Limitations and next steps

Phase 8A is a vertical slice: one neighbourhood experience, done properly. This page lists what is genuinely supported, what is not, and where each gap goes next.

## Supported in 8A

- **The world.** A real-time 3D view of the player's real city: every building with its City View model, road tiles with sidewalks and crossings, curb furniture, landscaping, the coast and sea, the sky.
- **The character.** The player's Life Mode character with their real appearance.
- **Controls.** Third-person camera with orbit, zoom, limits and obstruction handling; WASD walking and Shift running.
- **Collision.** Against building lots, open ground and curb furniture.
- **Authority.** Validated simulation steps, door and street spawns, recovery paths, view switching without losing anything, save/load and cloud saves through the normal world.
- **Living world.** Sun, sky and night lights from the game clock; nearby walking residents and nearby vehicles drawn from live simulation state.

## Not in 8A

| Gap | Why | Next |
|---|---|---|
| **Walking on open ground, lawns, parks and plazas inside venue lots** | Walkable ground equals the simulation's (roads). Lots, meadows and the beach are solid, so a park's lawn is an invisible boundary at its lot edge. | 8B: walkable public lots ("inside" a park as continuous space), paths through parks |
| **North and west façades** | The models were made for an isometric camera that sees only south and east faces. North and west sides are plain volumes, and decorative grass tufts read as small cones at eye level. | 8B / art pass: eye-level detail on all sides |
| **Interiors, doors that open** | Out of scope. Entering a building is still the simulation's "inside" state; the character appears at the door. | 8.5: playable interiors |
| **Interacting in 3D** (greet, chat, visit, rest, eat from the 3D view) | 8A is movement and presence. Those actions still work from Life Mode in the City View, on the same character. | 8C: 3D interaction prompts on the same Life commands |
| **Residents in venues, venue crowds, bus stops, people boarding** | Only residents walking outdoors and vehicles are drawn. Residents inside parks or venues and at bus stops appear only in the City View. | 8B: full living-world parity |
| **Collision with residents and vehicles** | They are drawn, not solid. The player can pass through a walking resident or a parked car. | 8C |
| **Vehicle night lamps, tinted at night** | Vehicles use their day materials at night. | 8B |
| **Far city** | The view stops at 30 tiles (20 in the light preset) behind fog; there is no far-city LOD. | 8B: impostors for distant blocks |
| **Touch controls** | Not implemented. Phones see no Enter World button; touch-only tablets get an explanation. | Later: on-screen stick + drag-look |
| **First-person camera** | Deliberately postponed. | Phase 9 |
| **Jumping, slopes** | The city is flat and nothing needs them. | n/a |
| **Software rendering playability** | About 5 fps under SwiftShader; it exists for CI. | n/a (a GPU is required to play) |
| **Residual memory per view switch** | About 0.1 MB per round trip after warm-up (V8 code, a few shader-source strings); no WebGL resources. | Monitor |
| **Walking energy only** | Manual walking costs energy like routed walking. Running costs no extra (the simulation has no running state). | 8C if wanted |

## Interfaces kept ready

- **`player.walk`** is the movement contract. 8B/8C can extend walkable ground (public lots) in `playerWalkCheck` and `buildWalkGrid` together; they are designed to stay identical.
- **`ResidentLayer` / `VehicleLayer`** read only `WorldState`. Venue crowds, stops and boarding can be added the same way: draw what the simulation has.
- **`buildAsset(id)` / `buildingAssetId()`** are the runtime model API. An eye-level art pass changes `scripts/art/**` and both views follow.
- **`resolveSpawn`** already handles venues and entrance legs; interiors (8.5) would add a "door → interior" transition on top.
