# Art direction and real-time assets

Target: premium cozy stylized 3D, in a modern coastal / luxury minimalist town. Polished miniature-life-simulator architecture, not photorealism.

## One source of truth for the models

The baked City View art is modelled procedurally in Three.js (`scripts/art/assets/*`, on `lib/kit.js` and `lib/modern.js`). The Character View runs **the same build functions at runtime**: `allAssets()` from the asset registry, then each model's `build(group)`.

- **Exact model parity.** A building shows the model the City View would draw for it. `buildingAssetId()` uses the City View's own `selectBuildingAsset` (saved design → exact model; classic buildings → their ID-hashed variant) over an index built from the same registry the bake writes its manifest from. Browser tests check that all six Luxury Minimalist villa models in the fixture appear by ID, and that a legacy save without designs uses classic models only.
- **Never substituted.** A building with no model (none exist in the current catalog) would be drawn as a clearly marked ivory massing on its exact footprint, with a terracotta band and a `fallback` flag listed in the stats. It would never be shown as a different model. Both test cities report zero fallbacks.
- **Turned to the road.** North- and west-facing lots reuse the S/E model turned half a turn; see [coordinate-systems.md](coordinate-systems.md).
- **Honest about what was modelled for above.** The models were built for a camera that sees only the south and east faces and the roofs. North and west faces are plain (closed volumes in the same materials), and a few details read as stylized cones at eye level (decorative grass tufts). See [limitations-and-next-steps.md](limitations-and-next-steps.md).

### Making it fast (`assetBuilder.ts`)

- Each model is built once per session and shared by every building that uses it.
- Meshes merge per material. Painted surfaces that differ only in colour share one material, with the colour moved into a vertex attribute (it multiplies the detail texture exactly as `material.color` did). Roughness is bucketed in steps of 0.2 and metalness in steps of 0.4, which is invisible at eye level. A villa drops from hundreds of meshes to about 20 draw calls.
- Roads and landscaping are instanced per model, per 12 × 12-tile chunk, so frustum and distance culling work. Ground cover is drawn only within 13 tiles.
- Night tags follow the bake: `userData.window` panes (62% lit, deterministic per model) glow warm, `userData.lamp` heads glow, and `userData.glow` gives coloured lights (venues). Each building's windows dim one by one at night with the City View's `windowsOn` rule.

## Materials and palette

The kit's palette and materials are used as-is: ivory render, light concrete, natural stone, walnut and oak slats, charcoal metal, bronze, glass and water. Glass and water reflect a small generated studio environment (`RoomEnvironment` through PMREM), whose intensity falls at night. The kit's procedural detail textures (plaster, render, stone, planks, concrete, paving, grass, leaves, asphalt) get world-unit UVs, so texel density is uniform.

## Lighting and sky (`atmosphere.ts`)

The City View's `worldLighting` keyframes (sun strength, night glow, phase) drive the 3D light, so golden hour and night arrive at the same game minute in both views. On top:

- **Sun.** It rises in the east (+X), peaks at 58° at 13:00 and sets in the west (−X) at 20:00, with a grazing minimum so golden-hour light still clears the roofs. Its colour runs from warm white through amber to rose, at intensity 3.1 × sun.
- **Shadows (high preset).** A 2048² PCF soft shadow map follows the character, snapped to texels so edges never crawl. Small props skip the shadow pass.
- **Sky.** A gradient dome (zenith, horizon and sun disc/glow) drawn behind everything, keyed across the day: daytime blue, golden horizon, violet dusk, navy night. Fog matches the horizon, which also hides the view-distance edge.
- **Fill.** A hemisphere light and environment are kept well under the sun (×0.62 and 0.12–0.38), so shadows read clearly but are never black.
- **Night.** A cool moon fill, lit windows, glowing lamp heads, and soft additive light pools spilling from each curb lamp onto the pavement.

## The character

- **Same rig, same appearance.** `buildCharacter()` composes the bake's rig layers (`scripts/art/characters/rig.js`) from `characterLayers(look, 'front')`, the City View's own appearance → layer mapping. Skin tone, hair style and colour, outfit and colour, and accessory (glasses, backpack, scarf, sun hat) are all supported. A browser test checks the composed layers for the test character (bun, jacket, glasses) and that they are identical after re-entering.
- **Eye-level scale.** The rig is 0.76 tiles tall for the City View; in 3D it is scaled to 0.27 tiles (≈ 1.75 m) against 3 m storeys and 2.2 m doors.
- **Grounded.** The feet are on y = 0 with a soft contact shadow, the figure casts real shadows, and live poses come from the rig's own pose function (walk phase, run blend, idle breathing).
- **Residents** use the same builder with `citizenLook(id)`.

## Screenshots

[screenshots/](screenshots/) has 15 real browser captures and five motion videos, all driven by real keyboard and mouse input in the real game; see [acceptance.md](acceptance.md).
