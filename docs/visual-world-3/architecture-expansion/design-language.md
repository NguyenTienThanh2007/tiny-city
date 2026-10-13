# Design Language

Visual World 3.1 keeps the 3.0 identity: stylized, cozy isometric miniatures with soft studio light, ambient
occlusion and readable silhouettes at the gameplay zoom. New collections change massing, roofline and materials,
not the rendering style, so old and new buildings sit together in one city.

## Luxury Minimalist (the benchmark collection)

- **Massing:** horizontal compositions, floating roof plates with thin dark reveals, cantilevers, stepped terraces,
  courtyards. No pitched roofs.
- **Materials:** ivory render `#f4efe6`, warm white plaster, light concrete `#d6d0c4`, natural stone `#cdbfa6`,
  walnut `#7a5236` and oak, charcoal metal `#3a3f43`, bronze `#b08d57` accents, large glass in slim charcoal mullions.
- **Light:** warm light lines in soffits and on entry steps, bollard lights along paths, sconces. All are tagged as
  lamps, so they glow in the night pass.
- **Landscape:** ornamental grass mounds, clipped shrub balls, multi-stem trees, column trees for rhythm,
  reflecting and lap pools, stepping stones, low ivory boundary walls with framed entries.
- **Rule:** each model has a distinct silhouette. No two Luxury Minimalist villas share a massing (pavilion,
  cantilever, L-courtyard, stepped terrace, long bar, shaded box).

## The other collections

| Collection | Massing and rooflines | Materials | Landscape |
|---|---|---|---|
| Modern Coastal | Steep standing-seam gables, glazed gable ends, deep porches | White board-and-batten, slate-blue metal, weathered timber decks | Dune sand, sea grasses, boardwalks, palms |
| Tropical Contemporary | Broad hipped shade roofs, tall pavilion roofs, open lanais | Cream render, timber louvres and soffits, breeze-block screens | Palms, bananas, fan palms, lagoon pools, boardwalks |
| Urban Premium | Curtain-wall boxes, setbacks, curved glass corners, lit crowns | Blue-grey glass, dark frames, bronze fins, silver floor lines | Paved plazas, planters, tree bosques, water jets |
| Family Garden Homes | Friendly gables with dormers and chimneys | Warm render, terracotta roof, white porch trim | Vegetable beds, play lawns, picnic tables, flowerbeds |

## Architectural detail library

`scripts/art/lib/modern.js` is a reusable library: every detail is a function, designed to read at gameplay zoom.

- **Structure:** `slab`, `roofDeck`, `stoneWall`, `boundaryWall`, `carport`, `pivotDoor`.
- **Facades:** `glassWall`, `framedWindow`, `slats`, `slatScreen`, `fins`, `glassRail`, `sconce`.
- **Roofs:** `roofGarden`, `skylight`, `solarPanels`, `slimPergola`.
- **Outdoor living:** `deck`, `terrace`, `lounge`, `loungers`, `diningSet`, `pool`, `driveway`.
- **Planting:** `grass`, `shrubBall`, `multiStemTree`, `columnTree`, `planterBox`, `steppingStones`.
- **Lighting:** `bollardLight`, `lightLine`.

The collections also reuse the 3.0 kit (`kit.js`: pitched `roof`, trees, palms, flowerbeds; `props.js`: signs,
cars, playgrounds).

Detail is never added just to raise a count. Examples of choices made during review: back-row column trees are
skipped where a house hides them; tall single-storey designs were raised until they meet the minimum clickable
height (24 px).
