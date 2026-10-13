# Visual World 3.0C: Character art direction

## Style

The characters are stylized miniature people that match the 3.0B buildings. They're modelled in 3D, lit by the
same warm key light, and baked through the same offline pipeline.

| Property | Choice |
|---|---|
| Proportions | About 3.3 heads tall. A big, readable head (r 0.112 tiles), rounded torso, capsule limbs and chunky shoes. Charming without exaggeration. |
| Height | 0.76 tiles baked (26 world px). Drawn at `RIG_LOCAL_SCALE` 0.86 × `npcSpriteScale`, about 22 units at normal zoom: roughly 1.4 storeys of a villa and about 1.8× its front door. That's deliberately a little larger than strict architectural scale so residents read at gameplay zoom. The minimum on-screen size still grows when zoomed far out (`npcSpriteScale`). |
| Face | Eyes with highlights, blush and a small mouth. Visible at close zoom, and suggested at normal zoom. The front facing is turned about 17° towards the camera so faces read while walking. |
| Palette | The Life Mode palettes (6 skin tones, 8 hair colours, 10 outfit colours) on white-baked layers. The bake's luminance range (about 0.6–1.0) keeps tints rich and shading soft. |
| Silhouettes | T-shirt, sundress (bare legs, flared skirt), open jacket over a cream shirt, overalls (bib and straps over a cream shirt), hoodie (hood and pocket). Hair: short, long (with back layer), bun, curly, cap, buzz. Accessories: glasses, backpack, scarf, sun hat. |
| Lighting | The same sun direction as the city; a soft contact shadow is drawn under every figure at runtime. At night, figures are lifted halfway to white (`liftTint`) so they stay readable without glowing. |

None of these characters copy an existing game's characters. The reference image only set the bar for charm and
readability.

## Appearance mapping

`src/game/art/characterLook.ts` is the single mapping, shared by the map, the Character Creator preview, portraits
and tests.

| Saved choice (`PlayerAppearance`) | Layers and tints |
|---|---|
| `skinTone` | `head`, `armSkin`, and `legs:bare` for dresses → `SKIN_TONES[i]` |
| `hairStyle` | `hair:<style>`; `long` adds `hairLong`; `cap` adds a `cap` layer (navy, or terracotta for outfit colour 0, as in 2.0) |
| `hairColor` | `hair`, `hairLong` → `HAIR_COLORS[i]` |
| `outfit` | Torso variant. Jacket and overalls draw a cream `shirt` plus an outfit-coloured overlay. Sleeves: tee and overalls short, jacket and hoodie long, dress none. Legs: dress bare, overalls outfit colour, jacket charcoal, others denim. |
| `outfitColor` | Torso, overlay and sleeves → `OUTFIT_COLORS[i]` |
| `accessory` | `glasses`, `backpack`, `scarf` (gold, or sea glass with mustard outfits), `sunhat` |

The mapping reproduces the 2.0 figure's colour rules exactly (`lookFromAppearance`). The saved schema is unchanged,
so old saves show the same person, now in 3D.

**Residents** use the same option sets, picked from a hash of their stable ID (`citizenLook`). Nothing is stored,
and a resident looks the same after save/load, undo and on another device (unit-tested). Residents also get
deterministic trouser and shoe colours. In a 200-resident population all 6 hair styles, 5 outfits and 6 skin tones
appear, with more than 150 distinct combinations.

## Asset generation

`scripts/art/characters/rig.js` builds the model and poses. `bake-characters.js` renders every layer variant ×
facing × pose × frame in one fixed orthographic window, so every frame shares one feet anchor.

- Limb layers (arms, sleeves, legs, shoes) are baked per side. In both baked facings the character's right side is
  nearer the camera, so a fixed back-to-front order per facing is always correct (`ORDER` in the rig and
  `CHARACTER_ORDER` at runtime).
- Hair, face, hats and glasses are baked with the bare head as a **depth-only occluder**. Only the parts in front
  of the head survive, so a hair layer never covers the face, whatever the combination.
- 1,364 frames on one 2048 × 1080 WebP page (about 0.5 MB, about 8.4 MB of GPU memory). The bake is byte-identical
  on re-run.
- `node scripts/art/character-review.mjs <dir> <out.png> 1 <k>` composes sample looks in every pose for review.

## Fallback

If the character atlas is missing, `hasCharacterArt` is false and residents and the player use the 2.0 vector
figures, with the same picking, rings and badges. Individual missing frames hide only that layer (tested).
