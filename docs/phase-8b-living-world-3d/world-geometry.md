# World geometry

## What is in the world

Everything in the plan and the bus network:

- **Buildings: all 17 catalog types.** `villa`, `duplex`, `townhouse`, `apartment`, `park`, `clubhouse`, `pool`, `mall`, `office`, `cafe`, `shops`, `market`, `cinema`, `nightclub`, `stage`, `plaza`, `amusement`.
  - Each is built from the bake's own procedural model, chosen exactly as the City View chooses its sprite (`buildingAssetId` = `selectBuildingAsset`, with the saved design).
  - Luxury Minimalist and collection models are used where the building has that design. Classic buildings keep their classic variant.
  - Facing comes from the building's road sides (`facingFor(roadSides(...))`), so doors meet the street.
- **Roads:** every tile with its connection mask (16 masks) and plaza tiles, with sidewalks, curbs and markings; merged per 12-tile chunk and per material.
- **Bus stops:** the shelter model (merged into one vertex-coloured mesh plus its sign), on the curb side `stopSide` picks. Solid.
- **Landscaping:** the City View's `planDecor` (trees, palms, flowers, grass, stones, lamps, benches, planters, bins, bikes). Curb furniture is solid; lamps get light pools at night.
- **Ground and sea** from the 8A terrain.

The acceptance fixture `LIVING_TOWN` has all six Luxury Minimalist villas, two apartments, an office, a café, shops, a market, a park, a stage, a plaza, roads and a two-bus line. Its e2e checks that the 3D entities (buildings, stops, road tiles) equal the saved world's plan. Coral Bay Nights (captures) and the benchmark cities add townhouses, duplexes, malls, cinemas, nightclubs, pools, clubhouses and an amusement park.

## Distance levels

| Level | High quality | Low quality | What is drawn |
|---|---|---|---|
| near | < 12 tiles | < 8 | The detailed model. It casts no shadow itself; an invisible proxy (`colorWrite: false`) of the mid geometry casts the shadow. |
| mid | < 40 | < 24 | `assetLod`: the same model in one vertex-coloured material plus a windows material, large parts only (> 0.24 tiles across or > 0.3 tall): one or two draw calls |
| far | < 80 | < 45 | One instanced massing block per building at its real footprint and model height; instanced low-poly trees per chunk |
| off | beyond | beyond | Nothing (fog closes at 84 / 48 tiles) |

Detailed landscaping is drawn within 16 tiles (11 on low quality). A hysteresis of 2 tiles stops buildings flickering between levels. Levels are re-evaluated every 200 ms around the character. Levels only change what is drawn: the simulation's entities are never culled, and collision always uses every building.

Low quality applies on software GPUs: no shadows, a pixel ratio of 0.5, and the shorter distances above.
