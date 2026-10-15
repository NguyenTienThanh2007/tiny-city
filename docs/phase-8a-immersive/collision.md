# Collision

There is no physics engine. The character moves in the ground plane, and the city's solid shapes are simple: grid tiles and a few posts. A capsule-against-tiles test is exact, cheap and deterministic. Triangle-mesh collision against decorative detail would cost more and behave worse (snagging on every planter edge).

## Walkable ground equals the simulation's

`buildWalkGrid(plan, decor)` (`src/immersive/collision.ts`) marks exactly the simulation's walkable tiles: **road tiles**. A road tile includes its asphalt, the sidewalks drawn along its open edges, and pedestrian squares.

Everything else is solid:
- building footprints (the lot edge, i.e. the authoritative `position` + `footprint`);
- open meadow, the beach and the sea;
- everything outside the map.

The rule is chosen so the character can never stand anywhere `playerWalkCheck` would refuse. Walls are not inferred from the 3D meshes, so collision always matches the authoritative footprints, whatever a model looks like.

On top of the tiles, curb furniture from the same deterministic decor plan the City View draws is solid:

| Furniture | Shape |
|---|---|
| Street lamp | circle, r 0.03 |
| Street tree trunk | circle, r 0.045 |
| Bin | circle, r 0.035 |
| Planter, bench (along either axis), bike rack | box |

Shapes are bucketed by tile, so a query looks only at the 3 × 3 tiles around the character.

## Movement (`moveCircle`)

The character is a circle of radius 0.07 tiles (≈ 0.45 m, the capsule's footprint).

- **No tunnelling.** A move is split into sub-steps no longer than half the radius, so nothing thin can be crossed at any speed or frame time. A unit test fires steps of 0.01, 0.3, 2.5 and 25 tiles at a villa lot and the character always stops at its edge.
- **Push-out.** After each sub-step the circle is pushed out of overlapping solid tiles and boxes (closest point, or the nearest face when the centre is inside), and out of posts. This repeats up to 4 times for corners.
- **Sliding.** Pushing diagonally into a wall keeps the component along it, so the character slides. Walking straight into a post leans the push sideways, toward the middle of the tile and perpendicular to the motion, so the character steps around it instead of stopping dead.
- **Speed cap.** A slide never covers more ground than the step asked for, so walking and running speed limits hold even around obstacles. A unit test runs past a lamp beside a wall and asserts the speed every frame.
- **Never off the ground.** If a sub-step would end off walkable ground (only possible from an invalid start), the move stops at the last valid point.
- `isClear` validates spawn points: a door spawn moves to the tile centre if a lamp stands exactly in front of the door.

## What collides and what does not

| Collides | Does not (yet) |
|---|---|
| Building lots (walls, garden walls and the lot edge are one boundary) | Other residents and vehicles: they are drawn, not solid, in 8A |
| Parks, pools and venues (their lots) | Low ground cover (flowers, grass tufts, pebbles) |
| Open ground, beach, sea, map edge | Trees and shrubs inside lots or in meadows: unreachable anyway |
| Curb lamps, street trees, benches, bins, planters, bike racks | |

## Tests

Unit tests:
- walkable tiles are exactly the road tiles;
- the stop and slide at a villa lot edge;
- no tunnelling at any step size;
- a lamp is solid and the character keeps its distance;
- sliding around a post head-on and alongside a wall, at no more than run speed;
- every controller position is accepted by the simulation.

Browser scenarios:
- H: W is held toward the villa opposite until the character is blocked; it never enters the lot.
- I: the character stays on walkable ground.
