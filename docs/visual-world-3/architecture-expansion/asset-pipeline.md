# Asset Pipeline

The Visual World 3.0 approach is unchanged. Models are built procedurally with Three.js and baked offline in
headless Chromium with the game's exact 56 × 28 projection, then packed into WebP atlases plus Pixi spritesheet
JSON and `manifest.json`. PixiJS draws them at runtime.

## What 3.1 adds

- **Asset modules:**
  - `scripts/art/assets/lm-villas.js`: six villas.
  - `lm-residential.js`: four duplexes, townhouses and apartments each, parametric in frontage like the classic bakes.
  - `lm-civic.js`: the Luxury Minimalist office, mall, clubhouse, pool and plaza.
  - `collections.js`: 14 models across the other collections.
  - All share `lib/modern.js`.
- **Asset IDs** are `<model id>.<S|E>`. Manifest records carry `model`. Classic records have no `model` and are
  still found by variant.
- **Atlas groups:** the new groups are `luxury` (`lm.*`: 2 colour pages and 1 soft page, 1.04 MB) and `collections`
  (`mc.*`, `tc.*`, `up.*`, `fg.*`: 2 + 1 pages, 0.77 MB). The classic `buildings` pages are byte-identical to 3.0C.
- **Catalog thumbnails:** `public/art/vw3/thumbs/<model id>.webp`, 192 px, composited from each asset's own colour
  and shadow passes in the same bake (no second render). There are 63 files, 387 KB, loaded lazily as `<img>`
  only when the selector is open, so they use no GPU atlas space.

## Runtime selection (`src/game/art/artManifest.ts`)

`selectBuildingAsset(index, { id, kind, design }, roadSides)`:

1. A design with a baked model → exactly that model; the facing comes from the road sides (S, or E when only the east side has a road).
2. A classic design → the classic bake of its variant.
3. A model missing from the bundle (e.g. retired) → another model of the same collection, stable per building.
4. No design, or no art for the collection → the classic variant from the building ID, unchanged since 3.0A.

New art is never chosen for a building without a design (test: `never gives a building without a design one of the
new models`). Every draw path still falls back to vector art per object if an atlas fails to load.

## Hit masks, depth, LOD and caches

- Alpha hit masks are built for every building colour frame, including the new ones, so tall art stays clickable.
- Depth uses the same `buildingDepth`.
- Decor LOD rules are unchanged.
- The vector-fallback texture cache key now includes the model, so a design change can never show a stale texture.

## Determinism

`npm run bake:art` (the full bake) is byte-identical across runs (verified). The bake page seeds `Math.random`,
but Three.js consumes it per object (UUIDs), so `--only=<group>` partial bakes can differ slightly in ambient
occlusion noise from a full bake. Commit only full-bake output.

## Bake time

A full bake takes about 15 s on an M2 (buildings 5.6 s, luxury 3.5 s, collections 2.1 s, nature, roads, characters).
