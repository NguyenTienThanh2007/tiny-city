# Visual World 3.0 — Art direction

**Target:** a cozy, stylized 3D isometric miniature town with a coastal lifestyle feel. It should read as an
art-directed indie game, not a set of geometric placeholders. The look is original to TINY CITY: no assets,
characters, logos or distinctive designs from other games are used or traced. The reference images only set the
quality bar and mood: warm light, layered architecture, rich planting, lively streets.

## Visual pillars

| Pillar | What it means in TINY CITY |
|---|---|
| Miniature architecture | Believable stylized proportions. Every building has a plinth, trim bands, corner quoins or pilasters, recessed windows with sills, real door frames, and roofs with thickness, overhang, ridge caps and tile courses. No flat cubes with painted windows. |
| Gardens as part of the lot | Each lot is a small diorama: lawn, hedges, flowerbeds, paths, pools or patios, and a signature tree. The garden sits flush with the terrain, so streets feel planted. |
| Warm, soft light | Golden key light from the upper left, a cool sky fill and a soft bounce. Self-shadowing, ambient occlusion (GTAO) in creases and at wall bases, and soft ground shadows. No bloom and no full-screen filters. |
| Coastal palette | Warm ivory and cream walls, coral and terracotta, muted turquoise and teal, sage and forest greens, warm timber, natural stone, blue-grey asphalt. Saturation is controlled: one or two accents per building. |
| Readability first | Silhouettes and roofs stay distinct at gameplay zoom (≈0.5–0.9). Night keeps the map readable: a moonlit tint plus warm windows and lamp pools. |

## Palette (scripts/art/lib/kit.js `PALETTE`)

| Role | Colours |
|---|---|
| Walls | ivory `#faf3e6`, cream `#f3e6cf`, sand `#e9d8b8`, linen `#efe4d2`, blush `#f2d7c4`, seafoam white `#d7e8df` |
| Roofs | terracotta `#c8674a`, slate `#5d6f78`, teal `#4f8b88`, sand `#d9a066` |
| Accents | coral `#e88b74`, turquoise `#5fb0aa`, teal `#3f8d8a`, gold `#f1c45f`, harbour blue `#5f8fa8` |
| Nature | leaf `#6f9e5c`, forest `#4c7d53`, moss `#587f45`, sage `#a3bb8c`, blossom `#ef9fb0` |
| Materials | timber `#a8754c`, walnut `#7a5236`, stone `#d2c7b2`, charcoal metal `#3d464b` |
| Ground | asphalt `#67737b`, paving `#e2d9c6`, curb `#d9d0be`, meadow `#96c47b`, lush `#76ab65`, dry grass `#bccc8c`, sand `#ead9a8`, shallows `#86cbc6` |
| Light | sun `#ffe6c4`, sky fill `#e6efff`, ground bounce `#dcc6a0`, window glow `#ffd27a`–`#fff0c4` |

## Architecture language (3.0A slice)

- **Villa (2×2):** a one-and-a-half-storey coastal house. Hip or gable roof, a projecting front bay with its own
  gable and round attic vent, shuttered windows, a glazed front door under a canopy, a chimney, and a single-storey
  garden wing with a roof terrace and glazed garden doors. The garden has a pool with loungers, a timber patio, or
  flowerbeds, plus a palm, cypress, blossom or broadleaf tree, hedges, a mailbox and a paved path.
- **Townhouse (2×3):** a row of narrow three-storey houses with individual facade colours, pilasters, cornices
  and balconies. Each unit gets a shopfront with a striped awning and sign board, or a stoop door with a planter.
  Rooflines vary between a front gable, a mansard, and a roof terrace with an umbrella. The paved street apron
  carries a street tree.
- **Apartment (4×4):** five storeys over a stone-clad ground floor. Window bays alternate with deep balconies
  (glass or bar railings), coloured vertical fins give the block an identity, and there's a glazed lobby with a
  canopy and a corner café with an awning. The roof carries a garden, pergola, plant room and solar panels. The
  forecourt has planters, a bench, bikes and café umbrellas, and a planted strip runs down the east side.
- **Park (4×4):** curving edged paths, mown lawn stripes, a centrepiece (fountain, pond with a footbridge and lily
  pads, or a pavilion), benches, lamps, flowerbeds, and mixed broadleaf, blossom, cypress and palm trees.
- **Streets:** asphalt with dashed centre lines, zebra crossings at junctions, raised paved sidewalks with joints
  and stone curbs on open sides, street trees and lamps on the curbs.

Each building type has three or four deterministic variants (palette, roof, yard, tree). Every non-park type comes
in both camera-facing orientations, so entrances face the street.

## Scale conventions

| Quantity | Value |
|---|---|
| Tile | 56 × 28 world px (2:1 dimetric, camera elevation 30°, azimuth 45°) |
| 1 scene unit | 1 tile edge; projects to 28 px horizontally and 14 px vertically per axis |
| Height | 1 scene unit of height = 34.29 world px (`HEIGHT_PX_PER_UNIT`); building art never rises above `buildingLift + roofCapHeight` at the footprint's north corner (unit-tested) |
| Storey | ≈0.43–0.6 units (villa ground floor 0.6, townhouse 0.43, apartment 0.44 over a 0.5 ground floor) |
| Door | ≈0.3 units tall; a resident sprite is ≈0.75–1.1 units, which reads correctly against doors and windows at gameplay zoom |
| Street tree | ≈0.9–1.1 units; palm ≈1.0–1.2 |
| Bake resolution | 2 texture px per world px (sharp up to ~1.5× zoom on standard displays); mipmapped for zoomed-out views |
