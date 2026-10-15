# Coordinate systems

## The three spaces

| Space | Definition | Owner |
|---|---|---|
| Simulation grid | Continuous `Position {x, y}`. Tile (i, j) covers [i, i+1) × [j, j+1). Authoritative. | `@tiny-city/simulation` |
| City View (Pixi world px) | `iso(x, y) = (32·56 + (x − y)·28, (x + y)·14)`. One unit of height rises `HEIGHT_PX_PER_UNIT` ≈ 34.3 px. | `src/game/mapGeometry.ts` |
| Character View (Three.js world) | **X = grid x, Z = grid y, Y = height**, 1 unit = 1 tile ≈ 6.5 m | `src/immersive/coordinates.ts` |

The 3D convention is the art pipeline's own (`scripts/art/lib/kit.js`: "grid x → +X, grid y → +Z, height → +Y"). The baked buildings were modelled in it, so the same procedural models drop into the 3D world unchanged.

### Not mirrored, not rotated

The City View camera looks from (+X, +Y, +Z) toward the origin. Its screen-right vector is +X − Z, and screen-down is +X + Z (minus height), which is exactly `iso()`'s (x − y, x + y). The unit test "is the same layout the City View shows" places an orthographic camera on that axis at the 2:1 dimetric elevation, projects 3D points, and checks they land on `iso()` (and `worldToIso` for raised points) to 6 decimal places. The test also checks the inverse (`toGrid`).

### Scale

A storey in the models is 0.46 tiles (≈ 3 m), a door 0.34 (≈ 2.2 m), a sidewalk 0.2 (≈ 1.3 m) and a mature tree 1.3–1.6 (≈ 9 m). That makes one tile ≈ 6.5 m, and the character is built 0.27 tiles tall (≈ 1.75 m). The City View draws people 0.76 tiles tall so they read from above. In 3D the same rig is scaled by 0.36 (`CHARACTER_SCALE`).

## Conversions (`coordinates.ts`)

- `gridToWorld(p, elevation)` / `worldToGrid(w)`: exact inverses with no arithmetic beyond renaming axes. A unit test round-trips 10,000 times with zero drift.
- `worldToIso(w)`: where a 3D point appears in the City View, used for framing the same place in both views.
- `footprintBox(building)`: a building's ground rectangle in 3D, taken straight from `position` and the catalog `footprint`.
- `yawFromGridDirection(dx, dy) = atan2(dx, dy)`. Yaw 0 faces +Z (grid +y, the art's street side) and yaw π/2 faces +X. `gridDirectionFromYaw` is its inverse. `angleDelta` gives shortest signed angles.

Positions are never derived from rendered sprite pixels.

## Placing a building

Models are built south-facing: the lot spans [0, w] × [0, d] with the street on +Z. `placementMatrix(building, facing)` returns the column-major matrix for each facing:

| Facing | Map (local x, z) → world | Model used | Matches City View |
|---|---|---|---|
| S | (x + bx, z + by) | the S asset | identical |
| E | (z + bx, x + by), the bake's x↔z mirror | the E asset (built with swapped dimensions, e.g. the mall) | identical |
| N | (W − x + bx, H − z + by), a half turn of S | the S asset | City View shows the S front |
| W | (W − z + bx, H − x + by), a half turn of E | the E asset | City View shows the E front |

Facing comes from the road sides, `facingFor(roadSides(building))`. A road on the south wins, then east, then north, then west. For S and E this is the City View's own rule. A building whose only road is north or west shows its S/E art in the City View (the isometric camera never shows north or west fronts), but turns its front to the road in 3D so the entrance meets the street.

Unit tests check, for all four facings on a 3 × 2 footprint, that the model's corners land exactly on the footprint and its front edge on the road side. They also check that mirrored facings have determinant −1; Three.js flips face winding for those objects automatically.

## Heights

- Lot plates have their top at y = 0.
- Road asphalt sits at −0.02 to 0 and the sidewalks at 0 to 0.024.
- The ground mesh is at −0.016 and slopes under the sea along the City View's coastline (x + y > 2·size − 8, with the same shore noise).
- The sea plane is at −0.05.
