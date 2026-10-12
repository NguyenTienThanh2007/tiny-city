# TINY CITY — UX/UI redesign ("Coastal Paradise")

This documents the Phase 3 redesign of the player-facing experience. It replaced the earlier three-column dashboard
(fixed tool column, map, fixed inspector column) with a full-bleed isometric world and floating game HUD surfaces.
Screenshots referenced here were captured with `node scripts/capture_ui.mjs` against the dev server and a mock-mode
planning API, and were reviewed visually. Before: `screenshots/before/`. After: `screenshots/after/`.

## Direction

Premium isometric city builder, modern coastal paradise: calm, playful, immersive. The canvas is the hero; panels are
warm ivory "paper" with soft depth, and the world gets daylight, sea and island depth. One theme is fully tuned rather
than two half-finished themes.

## Design system (`src/styles.css`)

All colors, radii, shadows and layout dimensions are tokens on `:root`; components reference tokens only.

| Token group | Values / purpose |
| --- | --- |
| Forest | `--forest-900…400` (#19302a → #6f9677): primary actions, active tool, headings |
| Sage | `--sage-300/200/100`: hover fills, quiet surfaces, meters |
| Ivory / paper | `--ivory #fbf7ee`, `--paper #fffdf8`, glass variants for floating surfaces |
| Sandstone | `--sand-100/200/400`: metrics, price chips, disabled submit |
| Terracotta | `--terracotta #c8714f` (+600/100): the single warm accent — play button, AI submit, next-step ring, badges |
| Sea | `--sea #5fa7a8`: coast, AI gradient border |
| Semantic | `--danger`, `--gold`; activity colors `--act-travel/work/leisure/home/sleep/idle`, used identically in pills, timeline, tiles and feed |
| Type | Display: Fraunces (soft optical serif) for the brand, panel titles, clock and key numbers. UI: Manrope. Tabular numerals for money, time and counts |
| Shape | Radii 6/10/14/20; shadows sm/md/lg tuned for warm green-tinted depth; 12 px layout gap |
| Motion | 150 ms hovers, 220–260 ms panel/sheet entrance with `cubic-bezier(.2,.7,.2,1)`, `prefers-reduced-motion` disables animation |

Reusable primitives: `Icon` (one 24-px stroke icon set), `outline-action`, `primary-action`, `icon-button`,
`panel-topline`, `section-heading`, pills (`activity-pill`, `status-pill`), `BuildingThumb` (isometric glyph matching
the in-world art) and `CitizenAvatar` (portrait from the same seed as the map sprite).

## Layout

- **Top bar** (full width, 64 px): brand + city name + save state (Local city / Unsaved changes / Saved on this device),
  the **Build · Plan · Live** mode switch, HUD stats (funds, residents, homes) and Undo/Redo/Save.
- **Tool dock** (left): Select, Road, Move, nine catalog buildings, Bulldoze, with prices and keyboard hints on hover.
- **Simulation dock** (top-left of the map): day/night icon, clock, day progress, play/pause, 1×/2×/4× and Step.
  Fixed widths prevent the controls from shifting as digits change.
- **Side panel** (right, 360 px): contextual — resident profile > building inspector > current mode panel.
- **Map tools** (bottom-right): zoom in/out, center city, and a top-down minimap with buildings, roads, walking
  residents (selected resident highlighted) and the camera footprint.
- **AI composer** (bottom): always-available prompt bar with an "AI options" toggle.
- The camera uses a HUD *safe area* so "Center city", focus and the initial view frame the visible map, not the
  area under panels. Pointer math and the minimap footprint still use the full canvas.

## Modes and panels

- **Build**: "Shape the neighborhood" — a first-steps guide computed from real state (road, home, workplace,
  residents, AI request, resident selected; hideable, remembered per browser), and a catalog grouped into Homes / Work /
  Leisure cards with thumbnail, footprint, capacity (residents / jobs / visitors), price, selected and
  unaffordable states.
- **Plan (AI Architect)**: suggestion chips, status chip, live status with recovery guidance for errors and stale
  plans, proposal card with full/partial badge, cost and post-plan budget, per-type **cost breakdown**, counts,
  placements, warnings, Approve/Reject, separate destructive confirmation, options and request history. On the map,
  previews are drawn as translucent blueprints with dashed white outlines plus an "AI preview · not built yet" ribbon,
  so they never read as built geometry.
- **Live**: before activation, a welcome card explains what residents do and that nothing changes until the player
  chooses. After activation: resident count, activity tiles, a jobs hint, "On the move" list (click to select +
  focus), and the City Life feed. The Live tab shows a badge for unseen feed entries.
- **Resident profile**: avatar, name, ID, age, activity pill, Focus and Follow, location, travel status with tiles
  left, home/workplace links (open the building), destination, walking pace, a 24-hour routine bar with a "now"
  marker, and the schedule list with the current entry highlighted. Only simulation fields are shown.
- **Building inspector**: hero with thumbnail and open/under-construction status; occupancy meter and linked
  residents/workers/visitors (click to open their profile) when residents are enabled; all previous details
  (type, footprint, capacity, location, cost, road access/connection, condition) and Details / Move / Demolish.

## World presentation (Pixi)

- Buildings redrawn with correct front-left/front-right walls, hip roofs for houses, windows and doors, glass towers
  with mullions and rooftop details, a pergola clubhouse, pool loungers and umbrella, a park with paths, pond, bench,
  trees and flowers. Geometry heights are unchanged, so roof hit-testing behaves as before.
- Terrain: grass variation with flat flower/grass decals, beach band, waves, and an island skirt along the front edges;
  the background reads as sea. Roads have curbs, connected asphalt and lane markings.
- Placement ghost shows the real building art at partial opacity on valid lots; invalid lots stay red.
- Hover/selection nameplate for buildings and residents; selection ring, destination outline and a remaining-route line
  for the selected resident.
- Daylight tint (dusk orange, night blue) follows the authoritative clock once residents live in the city.

## Responsive behavior

| Width | Behavior |
| --- | --- |
| ≥ 1100 px | Full layout as above |
| 900–1099 | Narrower panel (314 px), compact composer, hidden hint strip and event line |
| 760–899 | Brand text hidden, homes stat hidden |
| < 760 (phones) | Compact top bar (mark, modes, undo/redo, save); sim dock spans the top; tool dock stays on the left; side panel becomes a bottom sheet beside the dock and above the composer; tapping a mode opens/closes its sheet; AI panel uses the "AI options" toggle; minimap shrinks; zoom buttons hidden (pinch/scroll still zoom) |

Verified screens (all reviewed): `after/desktop-01-initial`, `-02-build-ghost`, `-03-plan`, `-04-ai-preview`,
`-05-ai-error`, `-06-live-welcome`, `-07-living-city`, `-08-citizen-inspector`, `-09-follow`, `-10-building-inspector`,
`tablet-01-initial`, `mobile-01-initial`, `mobile-02-build-sheet`, `mobile-03-live-sheet`, `mobile-04-citizen`,
`mobile-05-ai-panel`.

Floating surfaces are near-opaque paper rather than backdrop-blurred glass; blur over the live canvas halved software-rendered
frame rate for an almost invisible effect (see the acceptance report).

Issues found during review and fixed: simulation dock reflowing (and clipping the clock) as digits changed; tablet
top bar overlap; hovered "Saved" button losing its label; a crash from a negative hash modulo in avatar generation;
truncated activity labels; mobile home view zoomed too far out.

## Known limitations

- Text in Pixi nameplates uses the system fallback until the web fonts load.
- Only one theme (light, coastal) is provided by design.
- Minimap is top-down (grid) rather than isometric, as before.
- Fonts load from Google Fonts; offline sessions fall back to system fonts.

## Visual World 2.0 update (incremental, same identity)

Implemented on `feature/visual-world-ux-polish`; details, measurements and evidence in
[visual-world-2-acceptance.md](visual-world-2-acceptance.md) and `screenshots/visual-world-2/`.

- The Build panel now shows a contextual **selected-tool card**. The full catalog is opt-in because the left toolbar is
  the quick-access catalog.
- The side panel **collapses** behind a "Show side panel" handle, and the choice is remembered. Inspectors and the AI
  panel still open when relevant.
- The mode switch has a **sliding indicator**; funds changes show a floating delta chip; Save confirms with a pop.
- The AI panel has a **planner connection badge** and a **recovery card** with Retry, Check connection and dev setup
  steps.
- The minimap supports press-and-drag scrubbing and marks the selected building.
- The DOM daylight overlay was removed. Lighting now lives in Pixi as per-container tints with lit windows and
  streetlights.
- The "Under construction" inspector label was removed because it was not backed by simulation data.
