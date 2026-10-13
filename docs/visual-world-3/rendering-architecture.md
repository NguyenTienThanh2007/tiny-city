# Visual World 3.0 — Rendering audit and architecture

## 1. Technical rendering audit

Starting point (Visual World 2.0): every building, tree and road was drawn procedurally with Pixi `Graphics`
(flat-shaded polygons). Finished buildings were cached into textures, and the ground was cached once per plan
change. That was fast, but the look was capped: no real lighting, no self-shadowing, no occlusion, and every new
detail cost hand-written 2D projection code.

| Option | Visual fidelity | Runtime cost | Memory | Asset production | Maintainability | Animation | Iso-grid fit | Camera | Future expansion |
|---|---|---|---|---|---|---|---|---|---|
| **A. Enhanced Pixi procedural** | Medium: flat polygons, fake shading, no AO or real shadows | Low (cached) | Low | Every detail is 2D projection code; slow to iterate | Large hand-written draw code | Easy (vector) | Native | Unchanged | Hits a ceiling quickly |
| **B. Hand-authored iso sprites** | High if an artist paints them | Very low (sprites) | Atlas-bound | Needs a 2D artist per asset and variant; not available in this project | Assets drift in scale and light | Frame-by-frame | Must be painted to the grid | Unchanged | Linear artist cost |
| **C. Offline 3D → iso sprite sheets** | High: real lighting, shadows, AO, glass | Very low (sprites) | Atlas-bound (measured below) | Models in code; re-bake in seconds; consistent light and scale for free | Parametric kit, deterministic | Pre-baked frames, or runtime overlays | Exact: baked with the game's own projection | Unchanged | Add a model, re-bake |
| **D. Hybrid Pixi + authored assets + GPU effects** | High, plus runtime lighting layers | Low | Atlas + small runtime layers | As C for assets | Clear split: assets are static, the runtime does light and life | Runtime layers for people and lights | Native | Unchanged | Good |
| **E. Full real-time 3D (Three.js etc.)** | Highest ceiling | High: per-frame shadow maps, AO, thousands of meshes, 1–3k residents | High | Same models as C | Rewrites picking, depth sorting, UI overlays, Life Mode, tests | Skeletal or procedural | Needs a re-implemented iso camera | Rewrite | Engine migration |

**Decision: C + D.** TINY CITY keeps PixiJS 8 at runtime and gets a code-driven 3D art pipeline:

- Buildings, trees, props and road tiles are modelled procedurally with **Three.js in an offline bake**
  (`scripts/art/`). They're rendered in headless Chromium with the game's exact 2:1 projection, with physically
  based materials, a warm key light, sky fill, PCF soft shadows, glossy glass reflections (studio environment
  map) and **GTAO ambient occlusion**, then trimmed and packed into Pixi spritesheet atlases with a manifest.
- At runtime Pixi draws one textured quad per building, tree and road tile, batched from a few atlas pages.
  Time of day, night windows (baked emissive pass), lamp pools and ground shadows (baked shadow pass, faded by sun
  strength) are runtime layers. That is the GPU-effects half of D, without full-screen filters.
- **Three.js is a devDependency used only by the bake.** It is not in the game bundle, and no engine migration
  happened. Option E was rejected without a prototype: the measured runtime budget of the sprite path (§4) already
  meets the target at 300 commuting residents, and E would put picking, depth sorting, Life Mode and about 40
  browser tests at risk for no visual gain at this camera, which is fixed isometric with no rotation.

Limitations stated plainly: the assets are **procedural 3D models written in code**, not hand-sculpted or
hand-painted art. They reach a clean, stylized, consistent look, but they don't match the bespoke detail of a
professional art team. See *Known limitations* in `acceptance-3.0a.md`.

## 2. Asset pipeline

```
scripts/art/lib/projection.js   game grid constants (56×28 tile, 30° elevation, px per unit)
scripts/art/lib/kit.js          palette, materials, roofs, recessed windows, shopfronts, doors, awnings,
                                balconies, planters, hedges, trees (broadleaf, cypress, palm), shrubs, flowerbeds,
                                lamps, benches, umbrellas; `wall()` frames make every facade element work on any side
scripts/art/lib/stage.js        renderer, lights, camera fitting (origin snapped to an exact texture pixel),
                                passes (colour + GTAO, ground shadow, emissive), trimming, shelf packing
scripts/art/assets/*.js         villa, townhouse, apartment, park, nature/props, 16 road masks
scripts/art/bake-page.js        browser entry: instantiate, mirror east-facing variants, bake, pack
scripts/art/bake.mjs            Node driver (Playwright): `node scripts/art/bake.mjs` → public/art/vw3/
scripts/art/review.mjs          art review sheet (day + night composites, anchored shadows) for visual QA
```

- **Bake:** `node scripts/art/bake.mjs` (about 3 s on an M2) rewrites `public/art/vw3/*.png|json` and
  `manifest.json`. Preview individual assets with `--preview=villa.v0.S,road.m15`, then
  `node scripts/art/review.mjs`.
- **Deterministic:** every model uses a seeded RNG (mulberry32). Re-baking produces the same images. The manifest
  records a sha256 prefix per page.
- **Atlases:** 2048-wide pages, 6 px padding (mip-safe), Pixi spritesheet JSON with `meta.scale = 2`. Textures
  therefore report world-pixel sizes, and each frame's `anchor` is the footprint origin (buildings) or base point
  (nature).
- **Anchors and scale:** the camera frustum is fitted per asset, but always so that the scene origin, the
  footprint's north corner `iso(x, y)`, falls on an exact texture pixel. At runtime a sprite is placed at
  `iso(x, y)` and nothing else. Roads use a fixed tile frustum and overlap their neighbours by 0.02 tiles so tiles
  join without seams.
- **Orientation:** only the south (+Z) and east (+X) walls face the camera. Square buildings are modelled facing
  south and mirrored across the x = z diagonal for east-facing lots. Townhouses are rebuilt for the other frontage
  (2 vs 3 tiles) and then mirrored, so the footprint stays 2×3.
- **Validation:** `validateManifest` checks version, grid size, page limits, frame presence, facing and road
  masks, and that footprints match the simulation catalog. `src/game/art/artManifest.test.ts` also verifies that
  every frame exists in its page, that anchors are sane, that every slice kind ships both facings, that all 16 road
  masks exist, and that no building rises above its clickable cap.
- **Graceful fallback:** `loadArt()` resolves to `null` on any failure (missing file, bad manifest, no `fetch`), and
  every draw path falls back to the Visual World 2.0 vector art per object. Kinds not baked yet in 3.0A (duplex,
  clubhouse, pool, mall, office; and stones as decor) always use vector art.

## 3. Runtime architecture (PixiJS 8)

```
world
├─ terrain          painterly island (terrainArt.ts), drawn once → cacheAsTexture
├─ groundSprite     flat landscaping (flower patches, stones) generated into one texture per plan change
├─ roads            one baked tile sprite per road (mask = N1|E2|S4|W8); vector fallback
├─ shadowLayer      decor shadows + building shadows (baked); alpha = 0.2 + 0.8·sun
├─ groundOverlay    resident/player ground marks (unchanged)
├─ buildings        sortableChildren: building sprites, night-glow sprites, trees, lamps, residents, player
├─ proposalOverlay  AI previews (unchanged)
├─ effects, ghost (placement preview uses the real baked sprite at 70 %), labels
```

- **Depth sorting** is unchanged and shared with residents: building `zIndex = buildingDepth(x, y, w, h)`,
  night glow `+0.0005`, decor `x + y − 0.05`, residents `x + y`. Walkers pass correctly behind and in front of
  the new art.
- **Hit testing** is unchanged (`buildingAtPoint` uses `buildingLift`/`roofCapHeight`). The bake guarantees the
  art stays inside that box.
- **Construction:** the finished model rises out of its lot behind a reveal mask with scaffolding, in place of the
  vector height animation.
- **Selection:** a gold footprint outline and tint over the sprite (lot plates are opaque, so an under-layer would
  be hidden).
- **Lighting** (`lighting.ts`): keyframed tint (warm sunrise, neutral day, golden hour, violet dusk, moonlit
  night), `glow` for windows and lamps, and a new `sun` for shadow strength. Applied as container tints and alphas
  only.
- **Loading:** atlases load once per page (`loadArt` singleton) with mipmaps, linear mip filtering and 4×
  anisotropy. When they arrive, the viewport redraws buildings, roads and decor once. StrictMode remounts reuse
  the same promise.
- **No hidden state:** art selection uses only the building ID, kind and adjacent roads. Nothing is persisted,
  and the simulation, saves, undo and AI paths are untouched.

## 4. Performance

See `acceptance-3.0a.md` for the measured table (before vs after, same machine and browser flags) and texture
memory.
