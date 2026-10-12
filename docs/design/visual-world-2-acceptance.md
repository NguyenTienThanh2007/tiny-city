# Visual World 2.0 & premium UX polish — acceptance

Branch `feature/visual-world-ux-polish`, created from `origin/main` @ `585f1b9` (Phase 3A #7 and Phase 3B #8 merged).
No simulation rules, costs, capacities, footprints or save formats changed. Everything below is implemented unless it is
listed under *Recommendations*.

Evidence: `docs/design/screenshots/visual-world-2/before/` (captured from `585f1b9`) and `.../after/` (this branch), both
produced by `node scripts/capture_ui.mjs <url> <dir>` against the dev server and a mock-mode API. All screenshots were
reviewed; issues found during review are listed at the end of this section.

## World art (Pixi)

- **Buildings** (`src/game/buildingArt.ts`): all nine types redrawn with plinths, silhouette edges and soft drop shadows
  scaled by height. Houses get hip or gable roofs with tile courses, chimneys or solar panels, balconies with railings
  (multi-storey homes), framed windows with glass highlights, doors with optional awnings, and gardens. Apartments have
  balconies and roof gardens or water tanks; offices have curtain walls with mullions, a lobby canopy and an antenna; the
  mall has lit shop bays and striped awnings; the clubhouse has a pergola with vines; the pool has loungers and an umbrella;
  parks have three path layouts and a pond, fountain, gazebo or playground. Every type stays distinct.
- **Road-facing entrances**: the door sits on the visible wall that touches a road, and a walkway is drawn only when a real
  road tile touches that side.
- **Deterministic variants** (`buildingVariants.ts`): wall/roof/trim/glass/awning palettes, roof style, garden, roof
  accent, balconies and park layout/feature come from `hash(kind:id)`. No `Math.random`; identical across sessions,
  undo/redo and save/load. Hit-testing heights (`buildingLift`, `roofCapHeight`) are unchanged.
- **Roads**: paved sidewalks on open sides, curbs, continuous asphalt, dashed centre lines on straights, zebra crosswalks
  on every intersection approach, and streetlights on curbs facing open ground (never in walking lanes). All of it is
  derived from the authoritative road tiles.
- **Landscaping** (`worldDecor.ts`, `decorLayer.ts`): groves of trees (clustered value noise, kept ≥3 tiles from roads and
  buildings), sparse bushes, flowerbeds, stones, and palms/pebbles on the beach band. Never on roads, buildings or water.
  Tall items are hidden under any placement or move preview, so they never look like they block a lot. Rebuilt only
  when roads or buildings change.
- **Lighting** (`lighting.ts`): the authoritative clock drives golden hour, dusk, night and dawn as per-container
  multiply tints (terrain, ground, buildings, props, residents, sea), plus an unlit layer of night windows (a stable ~70%
  of windows per building) and additive streetlight pools. There's no full-screen overlay or filter. Lighting starts once
  residents live in the city; before that the map stays in daylight because the clock starts at midnight.
- **Construction feedback**:
  - Valid previews show the real building at partial opacity and mark the road tiles it will connect to in green.
  - "Must touch a road" previews show a dashed red outline.
  - Moves show a dashed travel line.
  - Bulldoze hover tints the target red.
  - Selection hover outlines buildings.
  - Completed builds, moves, demolitions, road tiles and AI batches play short pooled bursts. At most 48 run at once,
    and they are disabled under reduced motion.
- **No fake states**: the UI-only "Under construction" label was removed from the inspector because buildings are
  operational in the simulation immediately. The rise animation remains purely visual.

## Residents

- A dark silhouette outline gives contrast on asphalt and grass, and figures are 15% larger at normal zoom.
- A white hover ring appears on hover. The selected resident gets a stronger gold ring, a nameplate, and an
  activity-coloured badge (work, home, leisure, sleep, walking, idle). Badges appear only for the selected resident, so
  crowds stay clean.
- Idle residents breathe gently while walkers stride, so the two states read differently. Click radius grows slightly.
- Night tint applies to figures only; rings and badges stay bright. Positions still come only from the simulation.

## Smart HUD

- Sliding mode indicator for Build / Plan / Live.
- The Build panel no longer duplicates the nine-building toolbar. It shows a **selected-tool card** (footprint,
  capacity, cost, placement rule, hint). The full catalog is opt-in via "Browse building catalog".
- The **side panel collapses**: the Build/Live overview hides behind a "Show side panel" handle, and the preference is
  remembered. Inspectors and the AI panel still open when relevant.
- Funds changes show a floating −$/+$ chip, and Save confirms with a small pop.
- Minimap: press-and-drag scrubbing and a gold marker for the selected building.
- Desktop, tablet and phone layouts were re-verified in screenshots.

## AI Architect reliability

- **Root cause of the reported `PROVIDER_UNAVAILABLE`**: Vite listens on all interfaces, but the client called
  `http://127.0.0.1:8000` directly. Opening the dev server from another origin (LAN IP, phone) targeted the wrong host or
  failed CORS.
- **Dev-only same-origin proxy** (`src/aiArchitect/devProxy.ts`, `vite.config.ts`): `/api/*` → `127.0.0.1:8000`
  (override with `TINY_CITY_API_PROXY_TARGET`). Proxy failures return the retryable `PROVIDER_UNAVAILABLE` JSON instead of
  an HTML error. Production defaults and backend CORS are unchanged; `VITE_AI_ARCHITECT_API_URL` still wins.
- **`GET /v1/city/status`** (FastAPI): provider mode (`gemini`/`mock`/`custom`), whether a key is configured, and whether
  the TypeScript planner is built. It never calls the provider or reveals the key; `/health` is unchanged.
- **Connection badge**: checking / connected (Gemini configured · key missing · offline demo mode · planner not built) /
  reachable-but-readiness-unknown (an older API without the route) / unreachable. It is checked when the AI panel opens
  (at most every 15 s) or after a failed request; it is never polled. A successful status does not claim Gemini works.
- **Recovery card** for retryable failures:
  - It says the city is unchanged and the prompt is kept.
  - In dev it shows start-up commands, plus key or planner-build steps.
  - "Retry request" resubmits the same prompt; "Check connection" re-runs the status check.
  - Mock output is never substituted.

## Performance

Measured with `node scripts/npc_render_benchmark.mjs <url> [--software]`; results in
`docs/npc/render-benchmark-results.json` (key `visualWorld2`).

| Residents | Phase 3 GPU | VW2 GPU | Phase 3 software | VW2 software | Scene update ms (VW2 GPU / SW) |
| --- | --- | --- | --- | --- | --- |
| 30 | 60 | 60 | 30 | 33 | 0.05 / 0.08 |
| 100 | 60 | 60 | 29 | 31 | 0.09 / 0.13 |
| 300 | 60 | 60 | 17 | 16 | 0.25 / 0.33 |
| 1000 | 58 | 57 | 7 | 7 | 0.62 / 1.10 |

**Regression found and fixed.** The first Visual World build measured 16/17/9/5 fps under software rendering. Three
fixes brought it back:
- Tall decorations render as sprites of shared pre-rendered textures.
- Finished buildings are `generateTexture` sprites, keyed by everything that affects their look, so a selection re-renders
  one building.
- Roads and flat landscaping are one ground texture, rebuilt only on plan changes.

**Pixi crash found and fixed.** Under load, the dev build intermittently crashed with
`Cannot read properties of null (reading 'clear')`. The cause: React StrictMode's double mount destroyed an
`Application` whose async init finished after the second app had started, and `Application.destroy()` clears Pixi's
global batch pool. Two changes fix it:
- App lifecycles are serialized, so a disposed mount never creates a renderer.
- Off-stage render sources are destroyed a frame later, and cached render groups are never destroyed.

Memory: two full-map textures (terrain, ground) plus one small texture per distinct building look; unused building
textures are freed on every redraw.

## Tests (2026-10-12)

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass (strictness unchanged) |
| `npm test` | 110 passed (was 93) |
| `npm run test:simulation` | 212 passed |
| `npm run test:architect` | 31 passed |
| `npm run security` | 0 findings |
| `npm run build` | pass |
| API `pytest -q -W error` | 61 passed (3 new status tests) |
| `npm run test:e2e` | 29 passed (3 new in `e2e/visual-world.spec.ts`), mock planner only |

New coverage:
- **Variant determinism and variety, window lighting, decor placement rules and lighting curve:**
  `src/game/worldVisuals.test.ts`.
- **Planner status and reachability, base-URL resolution, proxy rewrite and proxy error body:**
  `src/aiArchitect/connection.test.ts`.
- **Collapsible panel and remembered preference, selected-tool card, connection badge states, unreachable recovery with
  retry and prompt kept, demo-mode labelling:** `src/App.test.tsx`.
- **Status endpoint (mock, missing key, no credential leak, never calls the provider, CORS):**
  `apps/api/tests/test_status.py`.
- **Browser (`e2e/visual-world.spec.ts`):** outage → diagnosis → retry → preview; HUD collapse, placement guidance,
  operational inspector and remembered preference; pixel-identical world before and after save/reload.

The Pixi lifecycle test now expects one `init` under StrictMode, which is the intended serialized behavior.

## Issues found in visual review and fixed

- Recovery buttons were mis-sized and the commands overflowed.
- A raw "HTTP 404" message appeared; an older API is now reported as "reachable, readiness unknown".
- The selected resident's nameplate overlapped their badge.
- The badge said "unreachable" while planning worked.
- The secret-scan rule rejected the credential name in frontend help text, so that copy was reworded.

## Known limitations

- Night lighting appears only after residents are welcomed (by design, see above).
- Building and ground textures are rendered at 1.5× and 1× resolution, so at maximum zoom on high-DPI screens the grass
  is slightly soft (buildings stay sharp).
- The minimap remains a top-down grid view (the e2e map-coordinate tests depend on it).
- No audio was added (optional in the brief).
- `docs/ai-architect/phase-2a.openapi.json` does not list the new status route.
- Fonts load from Google Fonts.

## Recommendations (not implemented)

Optional ambient audio with mute/volume controls, seasonal palettes, and an isometric minimap with updated coordinate
tests.
