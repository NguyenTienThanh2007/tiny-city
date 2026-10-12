# Visual World 3.0

The premium graphics overhaul of TINY CITY. It is delivered in three sequential subphases, each on its own branch
and PR.

| Subphase | Scope | Status |
|---|---|---|
| **3.0A Graphics foundation** (`feature/visual-world-3a`) | Art pipeline, renderer foundation, terrain, lighting, playable vertical slice (villa, townhouse, apartment, park, streets, sidewalks, lamps, trees, gardens) | See `acceptance-3.0a.md` |
| 3.0B Buildings & environment | Remaining five building types (duplex, clubhouse, pool, mall, office), commercial standards, roads and public spaces, vegetation pass | Not started; waits for 3.0A approval |
| 3.0C Characters & atmosphere | Residents and player redesign, living-city visuals, night atmosphere | Not started; waits for 3.0B approval |

## Documents

- [art-direction.md](art-direction.md): visual pillars, palette, architecture language, scale conventions
- [rendering-architecture.md](rendering-architecture.md): rendering audit (options A–E), the chosen hybrid
  pipeline, runtime layers, depth, lighting, fallback
- [asset-licensing.md](asset-licensing.md): where every asset comes from
- [acceptance-3.0a.md](acceptance-3.0a.md): what was implemented, before/after screenshots, benchmarks, tests,
  known limitations
- `screenshots/before`, `screenshots/after`: matched camera positions (`node scripts/capture_vw3.mjs [url] [dir]`)
- `benchmark-3.0a.json`: raw benchmark runs (`node scripts/vw3_benchmark.mjs [url] --label=… --out=…`)

## Working on the art

```sh
node scripts/art/bake.mjs                                    # re-bake every atlas into public/art/vw3 (~3 s)
node scripts/art/bake.mjs --preview=villa.v0.S,road.m15      # render chosen assets to tmp-art-preview/
node scripts/art/review.mjs                                  # day + night review sheet of the previews
npx vitest run src/game/art                                  # manifest, frames, heights, selection, fallback
```

The bake drives headless Chromium through Playwright (`npx playwright install chromium`). Three.js is a
devDependency used only by the bake and never ships in the game bundle.
