# Visual World 3.1: Premium Architectural Expansion

Visual World 3.1 adds an architecture layer to TINY CITY. The player chooses a collection and a specific model for
every building type in the Build panel. The placement preview shows exactly that model, construction records it,
and saves, cloud saves and undo/redo keep it. The AI Architect understands and honours style requests.

| | |
|---|---|
| Collections | 6: Classic Coastal, Luxury Minimalist, Modern Coastal, Tropical Contemporary, Urban Premium, Family Garden Homes |
| Models | 63 available (26 classic 3.0B designs, now selectable, plus **37 new baked models**), 3 planned |
| Luxury Minimalist | 23 models: 6 villas, 4 duplexes, 4 townhouses, 4 apartment buildings, plus an office, mall, clubhouse, pool and plaza |
| New art | 2 atlas groups (`luxury`, `collections`, 6 pages, 1.81 MB), 63 catalog thumbnails |
| Rules | Cosmetic only: cost, capacity, footprint and simulation behaviour never depend on the design |

## Documents

- [design-language.md](design-language.md): the visual language of each collection and the detail library.
- [architectural-catalog.md](architectural-catalog.md): every model, with its status.
- [style-selector.md](style-selector.md): the Build UI, preview, construction and district cohesion.
- [asset-pipeline.md](asset-pipeline.md): baking, atlases, thumbnails, selection, fallbacks and determinism.
- [ai-architect-integration.md](ai-architect-integration.md): intent, validation, planning, preview and approval.
- [compatibility.md](compatibility.md): data model, saves, cloud saves, undo/redo and older cities.
- [performance.md](performance.md): measured frame pacing, memory and loading against 3.0C.
- [acceptance.md](acceptance.md): requirement-by-requirement status, tests and CI.
- [screenshots/](screenshots/): real browser captures from `scripts/capture_vw31.mjs`.

## Commands

```sh
npm run bake:art                         # full deterministic bake (commit this output)
node scripts/vw31_city.mjs               # validate the showcase cities
node scripts/capture_vw31.mjs <after> <before> docs/visual-world-3/architecture-expansion/screenshots
node scripts/vw31_benchmark.mjs <url> --label=x --out=f.json [--designs=off]
npx playwright test e2e/visual-world-3-1.spec.ts
```
