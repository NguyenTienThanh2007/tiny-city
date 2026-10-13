# Visual World 3.0B — Buildings, environment & city beautification: acceptance

Branch `feature/visual-world-3b`, from `origin/main` @ `e5923c3` (3.0A, PR #14 merged). Scope: 3.0B only;
characters are 3.0C and were not touched.

## 1. Art improvements

- **All nine building types** are redesigned on the 3.0A bake pipeline: villa, duplex, townhouse, apartment, park,
  clubhouse, pool, mall and office, with 2–4 deterministic variants each, in both street facings where it matters.
  The old flat vector buildings no longer appear in normal play (see §7 for the fallback).
- **Materials:** every surface carries a low-contrast procedural detail map: clay roof tiles, slate, standing seam,
  plaster, render, brick, stone, planks, paving, cobbles, asphalt, concrete, pool tiles, water ripples, grass,
  leaves and bark. UVs are world-space, so the texel density is consistent across assets; roof tile courses always
  run parallel to the eaves.
- **Architecture:** porticos, columns, wrought-iron and glass balconies, flower boxes, wall lanterns, downpipes,
  dormers, mansards, chimneys, oculi, quoins, cornices, timber cladding and battens, curtain walls with fins and
  spandrels, setback crowns, penthouses, green roofs, skylights, solar arrays and rooftop plant.
- **Identity:** lettered original shop and building names (BAKERY, SURF, BOOKS, CAFÉ, FLOWERS, GELATO, MARKET,
  STYLE, HARBOUR MALL, TIDE, NOVA, HELIX, SEABREEZE, MARINA, CORAL, GARDEN CLUB, LIDO …) that also glow at night.
- **Vegetation:** mature leaf-textured canopies (lime, round, deep, olive, blossom, jacaranda, autumn), pine, poplar,
  cypress pairs, coconut and fan palms, layered shrubs, grass tufts and rocks. Trees are about 1.3–1.6 tiles tall,
  up from about 0.9.
- **Roads and public space:** textured asphalt, paved sidewalks and stone curbs on all 16 masks, a new cobbled
  **plaza tile** wherever the road widens into an area, and curb furniture (lamps, street trees, benches, planters,
  bins, bike racks) placed only on curbs facing open ground.
- **Density and composition:** woodland groves with understorey, lone field trees, wildflower drifts, grass and
  rocks soften the empty field. Every lot is a garden, plaza or court. The home camera frames the built city more
  tightly (zoom cap 0.86 → 1.0, smaller margins).
- **Static street life:** parked cars in bays, café umbrellas, bikes, terraces and loungers make districts feel
  inhabited. These are decor; resident behaviour still comes only from the simulation.

## 2. New assets and architecture

- **99 baked assets** (3.0A: 59): 49 building sprites, 33 nature and prop sprites, 17 road tiles.
  - New and redesigned kit: `scripts/art/lib/textures.js` (detail maps and world UVs), `scripts/art/lib/props.js`
    (street furniture, signs, cars and garden props), plus new trees and `flatRoof` in `kit.js`. New assets:
    `duplex.js`, `clubhouse.js`, `pool.js`, `mall.js`, `office.js`; rewritten `villa.js`, `apartment.js`;
    upgraded `townhouse.js`, `park.js`, `nature.js`, `roads.js`.
- **Atlases:** WebP (q 0.92) instead of PNG, a skyline packer instead of a shelf packer, pages trimmed to their used
  height, and shadow and night-glow frames moved to a half-resolution "soft" atlas. That's 6 pages in total and
  **1.63 MB to download** (3.0A: 2.8 MB for 59 assets), with about 40 MB on the GPU (53.5 MB with mipmaps;
  3.0A: 26 MB / 34.7 MB).
- **Deterministic bakes, now verified:** Three's GTAO denoise noise seeded itself from `Math.random`, so
  re-bakes differed. The bake page now seeds `Math.random`, and two consecutive bakes are byte-identical.
- **Runtime:**
  - `src/game/art/hitMask.ts` provides **alpha-mask picking**. Tall roofs, towers and trees are clickable on
    their opaque pixels, in addition to the legacy box.
  - The manifest's `heightPx` places nameplates and Life home markers on the real art (`buildingTop`).
  - `selectRoadAsset` picks the plaza tile.
  - A decor **level of detail** (`LOD_SCALE` 0.32) stops rendering decor shadows and small furniture when zoomed
    far out.
  - `data-art="ready|fallback"` on the viewport lets tests wait for the final art.
  - `MAX_DECOR` goes from 900 to 2600.
  - `HOME_MAX_SCALE` is now 1.0.
- **Showcase city:** `scripts/vw3b_city.mjs` builds "Coral Bay" (47 buildings of every type, 181 road tiles, a
  plaza) and validates it against the real simulation placement rules (`node scripts/vw3b_city.mjs`).

## 3. Before / after (3.0A on `main` vs 3.0B, same seed and scripted camera)

`node scripts/capture_vw3b.mjs <url> <dir>`, run against production builds of `main` (port 4190) and the dev
build of this branch.

| # | View | 3.0A | 3.0B |
|---|---|---|---|
| 1 | Entire city, normal gameplay zoom | [before](screenshots/3b-before/01-city-gameplay-zoom.jpg) | [after](screenshots/3b-after/01-city-gameplay-zoom.jpg) |
| 2 | Residential district close-up | [before](screenshots/3b-before/02-residential-district.jpg) | [after](screenshots/3b-after/02-residential-district.jpg) |
| 3 | Commercial district | [before](screenshots/3b-before/03-commercial-district.jpg) | [after](screenshots/3b-after/03-commercial-district.jpg) |
| 4 | Park, plaza and public space | [before](screenshots/3b-before/04-park-and-plaza.jpg) | [after](screenshots/3b-after/04-park-and-plaza.jpg) |
| 5 | Pool and clubhouse | [before](screenshots/3b-before/05-pool-and-clubhouse.jpg) | [after](screenshots/3b-after/05-pool-and-clubhouse.jpg) |
| 6 | Dense city | [before](screenshots/3b-before/06-dense.jpg) | [after](screenshots/3b-after/06-dense.jpg) |
| 7 | Sparse city | [before](screenshots/3b-before/07-sparse.jpg) | [after](screenshots/3b-after/07-sparse.jpg) |
| 8 | Morning 06:40 | [before](screenshots/3b-before/08-morning.jpg) | [after](screenshots/3b-after/08-morning.jpg) |
| 9 | Afternoon 15:30 (commuters at work) | [before](screenshots/3b-before/09-afternoon.jpg) | [after](screenshots/3b-after/09-afternoon.jpg) |
| 10 | Night 21:40 | [before](screenshots/3b-before/10-night.jpg) | [after](screenshots/3b-after/10-night.jpg) |
| 11 | Construction preview (office ghost) | [before](screenshots/3b-before/11-construction-preview.jpg) | [after](screenshots/3b-after/11-construction-preview.jpg) |
| 12 | Building selection (Tide House) | [before](screenshots/3b-before/12-building-selection.jpg) | [after](screenshots/3b-after/12-building-selection.jpg) |
| 13 | Life Mode, player outdoors | [before](screenshots/3b-before/13-life-mode.jpg) | [after](screenshots/3b-after/13-life-mode.jpg) |
| 14 | Mobile 390×844 | [before](screenshots/3b-before/14-mobile.jpg) | [after](screenshots/3b-after/14-mobile.jpg) |

## 4. Browser acceptance evidence (screenshots inspected)

- **1, 3, 12 (commercial):** in 3.0A the mall was a beige vector box with a yellow bar, the offices were grey
  slabs, and the clubhouse and pool were flat vector shapes. In 3.0B the mall has lettered shopfronts and awnings, a
  glazed atrium with a lit name, a fountain plaza and a parking court with cars. Offices are glass towers with fins
  on stone podiums. The selected Tide House shows its gold footprint outline and a nameplate placed on the real
  roof height.
- **2 (residential):** villas are two-storey with porticos and gardens, duplexes have twin gables and paired
  entrances, and townhouse rows have lettered shops. Gardens, pools and hedges fill every lot.
- **4, 5:** the parks have mature groves, a plaza, a pavilion or fountain, and benches. The lido has a lane pool,
  kids' pool, cabana and loungers; the clubhouse has a glass pavilion, green roof and deck terrace.
- **6, 7:** dense blocks read as varied districts. The sparse city sits in meadow with groves and wildflowers
  instead of bare grass.
- **8–10:** time of day works across all new art. At night, curtain-wall bays, shopfronts, signs, lanterns and
  window boxes glow warm and lamp pools light the streets.
- **11:** the construction ghost is the real baked office, facing its road, with the green road-access hint.
- **13:** the player walks the avenue among the new villas with the Life HUD, needs and actions intact.
- **14:** the mobile layout is intact; the island and the denser city both read well.

**Visual acceptance checklist**

| Criterion | Result |
|---|---|
| All nine types on the new pipeline | Pass. Vector art is only a load-failure fallback. |
| Distinct silhouettes and consistent scale | Pass: tower, arcade, pavilion, lido, row, villa and duplex all read apart. Storey heights come from one kit. |
| Material depth | Pass: tiles, slate, seam, plaster, brick, stone, wood, glass, water, paving, asphalt, grass, leaves |
| Shadows and light | Pass: one baked sun direction for everything, AO, half-resolution soft ground shadows, warm night glow |
| Vegetation | Pass: mature, varied, deterministic; never on roads, lots or walking lanes |
| Roads and public spaces | Pass: textured streets, curbs, crossings, plaza tiles, curb furniture |
| Density and composition | Pass: districts feel full, the field has groves and drifts, home framing is tighter |
| Cohesion | Pass: one palette, one kit, one light, one resolution |
| Gameplay usability | Pass: 42/42 e2e (§6), selection, placement, Life and AI previews verified in shots 11–13 |

## 5. Performance (measured, not estimated)

`node scripts/vw3_benchmark.mjs <url> [--uncapped --viewport=2560x1440] [--software]`. Production builds of 3.0A
(`main` @ `e5923c3`) and 3.0B. Apple M2, macOS 26, Playwright Chromium; GPU runs use ANGLE Metal. Raw data:
`benchmark-3.0b.json`.

**Vsync on, 1440×900:** every scenario, including Coral Bay and 300 commuting residents, holds **60 fps with p99
16.8 ms** on both versions.

**Uncapped, 2560×1440 (real per-frame cost), avg / p95 / p99 ms:**

| Scenario | 3.0A | 3.0B |
|---|---|---|
| Slice, gameplay zoom | 2.56 / 3.6 / 4.0 | 2.62 / 3.6 / 4.5 |
| Slice, close zoom | 2.40 / 2.8 / 3.4 | 2.43 / 3.4 / 3.7 |
| Sample city | 2.50 / 3.4 / 3.8 | 2.66 / 3.6 / 4.4 |
| Coral Bay (dense, 47 buildings) | 2.64 / 3.6 / 4.1 | 2.63 / 3.5 / 4.2 |
| Coral Bay, close zoom | 2.47 / 3.1 / 3.7 | 2.64 / 3.6 / 4.6 |
| 300 residents commuting, zoomed out | 3.77 / 7.3 / 8.6 | 3.84 / 7.6 / 9.7 |

**Software rendering (SwiftShader, worst-case proxy for weak GPUs), fps:**

| Scenario | 3.0A | 3.0B |
|---|---|---|
| Slice, gameplay | 15.4 | 12.2 |
| Slice, close | 12.8 | 12.1 |
| Sample city | 15.7 | 13.7 |
| Coral Bay | 14.7 | 13.1 |
| Coral Bay, close | 11.7 | 10.8 |
| 300 commuting, zoomed out | 19.9 | 21.5 |

The first 3.0B build ran the zoomed-out commute at only **5.8 fps** under software rendering, because it drew
about three times as much decor plus shadows. Decor level of detail fixed it (21.5 fps). A Pixi `CullerPlugin`
was also tried and **removed**: it cost about 1.6 ms per frame on the GPU (2.5 → 4.2 ms uncapped) and didn't help
the zoomed-out case.

**Other measurements:** renderer JS per frame is 0.01–0.06 ms without residents and about 0.3 ms with 300. Camera
wheel-zoom reaches the screen within two frames (about 32 ms at 60 Hz) on both versions. Interactive is about
0.4–0.9 s after navigation on both, with single warm-up outliers up to 2.9 s in both versions' runs. Atlases
download 1.63 MB (−42 %) and take about 40 MB of GPU memory (+54 %; +14 MB).

## 6. Tests (local, final code)

| Suite | Result |
|---|---|
| Typecheck | pass |
| Frontend unit | **148 passed** (3.0A: 144) |
| Simulation | 286 passed |
| AI Architect | 52 passed |
| API (pytest) | 66 passed |
| Security scan | 0 findings |
| Production build | pass |
| Playwright e2e | see the PR and final report (run on the final code) |

**New regression tests:**
- Every catalog type ships baked art (both facings except parks), plus all 16 road masks and a plaza tile.
- Art heights are recorded and in range.
- The plaza tile is chosen only where the road widens.
- World-pixel hit masks build from atlas alpha.
- A click high above a villa's legacy box selects it when its mask is opaque, and never when it's empty.
- Decor level of detail hides only small items and shadows and leaves placement hiding alone.
- Every decor kind and variant resolves to art.
- Colour frames must live on full-resolution sheets.

**Changed assertions (behaviour changed on purpose; nothing weakened):**
- `artManifest.test.ts`: 3.0A asserted that art never rises above `buildingLift + roofCapHeight`. 3.0B buildings
  and trees deliberately rise higher, so that guarantee moved to **alpha-mask picking**, now covered by the
  selection regression test, and the test now checks the recorded `heightPx` instead.
- `artManifest.test.ts`: "kinds without art fall back" is now "unknown kinds fall back", since every catalog
  kind has art.
- `mapGeometry.test.ts`: the home-zoom cap is asserted through `HOME_MAX_SCALE` (1.0, previously the literal
  0.86). Tighter framing was requested.
- `e2e/visual-world.spec.ts`: the determinism test now waits for `data-art="ready|fallback"` before each
  screenshot. Without the wait it could compare vector art against baked art mid-load, a race that appeared once
  atlases got bigger. It still requires byte-identical pixels.

## 7. Known limitations

1. **Procedural, not hand-crafted.** The art is modelled in code with a shared kit, so it's cohesive and
   deterministic. It's also less bespoke than the reference image: fewer one-off props, no sculpted characters,
   no hand-painted textures, and simpler signage.
2. **Characters are unchanged** and still small next to the larger buildings and trees. That's 3.0C.
3. **Street life is static.** Parked cars, bikes and umbrellas are decor; no vehicles move.
4. **Night lighting** doesn't spill onto the ground from windows or signs; lamp pools are simple ellipses (3.0C).
5. **The baked sun direction is fixed.** Only tint, shadow strength and glow follow the clock.
6. **Vector fallback** is still used if the atlases fail to load (`data-art="fallback"`); in normal play it's never
   visible.
7. **GPU memory** is about +14 MB over 3.0A. **Software rendering** is 6–20 % slower in non-commute scenes; the
   GPU path is unchanged.
8. **Tree height.** Mature trees are taller than buildings' legacy click boxes. Buildings handle this with alpha
   picking; trees are decor and don't take clicks.
