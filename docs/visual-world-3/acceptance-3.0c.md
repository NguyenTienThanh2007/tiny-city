# Visual World 3.0C: Characters, animation and atmosphere (acceptance)

Branch `feature/visual-world-3c`, cut from `origin/main` @ `78c6927` (3.0B, PR #15, merged). No earlier 3.0C work
existed. The 3.0A/3.0B offline 3D → baked sprite pipeline and the PixiJS 8 runtime are reused unchanged. The
simulation, save schema and gameplay rules are untouched.

## 1. Visual improvements

- **New characters.** Residents and the player are now stylized 3D miniature people baked through the same
  pipeline as the city. They're about 3.3 heads tall, with readable faces, hair styles, outfits and accessories,
  lit by the same sun and grounded by a contact shadow. 2.0's flat vector figures are only a fallback.
- **Scale and readability.** Figures are about 15 % taller than before (about 1.4 villa storeys) and readable at
  normal zoom. At night they're lifted towards white so they stay visible.
- **Smooth animation.** An 8-frame walk cycle driven by actual displacement (pause freezes mid-stride, no sliding),
  de-synchronised breathing idles with occasional glances, and waving or chatting during real Life Mode greetings.
- **The city looks alive.** The simulation keeps leisure visitors *inside* parks, pools and clubhouses, and 2.0–3.0B
  drew them nowhere, so busy parks looked empty. 3.0C draws every real visitor (up to each venue's spots) on the
  lawn, deck or terrace, chatting in pairs, sitting or standing. In the Coral Bay showcase that's 27 visible park
  visitors at 17:55 (3.0B: 0) and a full lido and terrace at 18:13.
- **Cinematic day cycle.** Fresh sunrise, neutral midday, amber golden hour, violet dusk and a lifted moonlit night,
  with smooth transitions.
- **Cosy nights.** Warm light pools spill from building facades (strongest at the mall, clubhouse and offices),
  softer street-lamp pools, homes going dark one by one after 23:00, and shops closing gradually.
- **Ambient life.** Gentle tree and palm sway, pool water shimmer by day, fireflies over parks at night. All frozen
  under reduced motion and while the clock is paused.

## 2. Character and animation architecture

See `character-art-direction.md` and `animation-system.md`.

- **Asset generation** (`scripts/art/characters/`): a posable rounded-primitive rig, baked per layer, side, facing,
  pose and frame. Hair, face and hats bake with the head as a depth-only occluder. That's 1,364 frames on one 2048 ×
  1080 WebP page, and re-bakes are byte-identical.
- **Runtime:**
  - `characterLook.ts`: pure appearance → layers mapping, deterministic resident looks, pose selection.
  - `characterRig.ts`: a sprite per layer, updated only when something changes.
  - `npcLayer.ts` and `playerLayer.ts`: integration with the existing motion, picking, rings and badges.
  - `venueCrowd.ts`: real visitors → venue spots.
  - `npcMotion.figureDepth`: lot-aware depth.
- **Character Creator and portraits** show the same baked figure, composited on an offscreen canvas and shown as
  an `<img>` (so the map stays the page's only `<canvas>`). Accessible names are unchanged (`Preview of …`).
- **Persistence:** none added. The player still saves `PlayerAppearance`, and resident looks derive from their IDs.

## 3. Lighting implementation

See `lighting-and-atmosphere.md`. In short, it's a hybrid: baked shading with a fixed sun direction, plus a runtime
tint, sun strength (shadow alpha) and glow (windows, lamp and building light pools). Interpolation uses
smoothstep and is tested minute by minute for jumps. There are no overlays, filters or bloom.

## 4. Before / after (3.0B `main` vs 3.0C, same seed, scripted camera and clock)

Captured with `node scripts/capture_vw3c.mjs <url> <dir>` against a production build of `main` (port 4190) and
this branch. Every image below was inspected.

| # | Scene | 3.0B | 3.0C |
|---|---|---|---|
| 1 | Player and resident close-up | [before](screenshots/3c-before/01-player-npc-closeup.jpg) | [after](screenshots/3c-after/01-player-npc-closeup.jpg) |
| 2 | Character Creator | [before](screenshots/3c-before/02-character-creator.jpg) | [after](screenshots/3c-after/02-character-creator.jpg) |
| 3 | Distinct residents on the street | [before](screenshots/3c-before/03-distinct-npcs.jpg) | [after](screenshots/3c-after/03-distinct-npcs.jpg) |
| 4 | Walking and direction | [before](screenshots/3c-before/04-walking.jpg) | [after](screenshots/3c-after/04-walking.jpg) |
| 5 | Idle, pool and terrace visitors | [before](screenshots/3c-before/05-idle-terrace.jpg) | [after](screenshots/3c-after/05-idle-terrace.jpg) |
| 6 | Social: the player greets a resident | [before](screenshots/3c-before/06-social.jpg) | [after](screenshots/3c-after/06-social.jpg) |
| 6b | Park conversations | [before](screenshots/3c-before/06b-park-conversations.jpg) | [after](screenshots/3c-after/06b-park-conversations.jpg) |
| 7 | Residents using the park | [before](screenshots/3c-before/07-park-visitors.jpg) | [after](screenshots/3c-after/07-park-visitors.jpg) |
| 8 | Behind buildings and trees | [before](screenshots/3c-before/08-behind-buildings-trees.jpg) | [after](screenshots/3c-after/08-behind-buildings-trees.jpg) |
| 9 | Morning 07:15 | [before](screenshots/3c-before/09-morning.jpg) | [after](screenshots/3c-after/09-morning.jpg) |
| 10 | Midday 12:30 | [before](screenshots/3c-before/10-midday.jpg) | [after](screenshots/3c-after/10-midday.jpg) |
| 11 | Golden hour 18:45 | [before](screenshots/3c-before/11-golden-hour.jpg) | [after](screenshots/3c-after/11-golden-hour.jpg) |
| 12 | Night, residential, 21:50 | [before](screenshots/3c-before/12-night-residential.jpg) | [after](screenshots/3c-after/12-night-residential.jpg) |
| 13 | Night, commercial | [before](screenshots/3c-before/13-night-commercial.jpg) | [after](screenshots/3c-after/13-night-commercial.jpg) |
| 14 | Dense city, 300 residents commuting | [before](screenshots/3c-before/14-dense-city.jpg) | [after](screenshots/3c-after/14-dense-city.jpg) |
| 15 | Normal gameplay zoom | [before](screenshots/3c-before/15-normal-gameplay-zoom.jpg) | [after](screenshots/3c-after/15-normal-gameplay-zoom.jpg) |
| 16 | Mobile 390 × 844 | [before](screenshots/3c-before/16-mobile.jpg) | [after](screenshots/3c-after/16-mobile.jpg) |
| 17 | Life Mode following the player | [before](screenshots/3c-before/17-life-follow.jpg) | [after](screenshots/3c-after/17-life-follow.jpg) |

**Animation evidence:** frame sequences recorded at 1× in the running game (140–260 ms apart) for street walking,
player walking, the greeting, park visitors and terrace and pool idles are in `screenshots/3c-*/sequences/`. A
contact sheet is at `screenshots/3c-after/sequences-contact.png`. Reviewed: walkers advance and change stride
frames along the road, the pool shimmers, and visitors hold their spots with idle and chat poses. Resident
character close-ups composed from the atlas are also in the character review sheets produced by
`scripts/art/character-review.mjs`.

## 5. Why the city looked quiet: diagnosis

| Suspected cause | Finding | Fix |
|---|---|---|
| Simulation schedules | Real. At night almost everyone is at home (167 of 168 at 21:56), and at midday most are at work. That's by design; varied schedules are Phase 7. | None; documented |
| Venue visitors hidden | **Main cause in the evening.** Leisure visitors are `inside` the park, pool or clubhouse and were never drawn (26–59 residents in Coral Bay). | `venueCrowd.ts` draws each real visitor at the venue |
| Scale and contrast | Figures were small (about 19 units) with flat colours against detailed 3.0B art | Baked 3D characters about 15 % larger, contact shadow, night lift |
| Layering | A figure standing inside a lot (entrance path, walk-in) sorted under the opaque 3.0B lot plate | `figureDepth` raises figures above the lot they stand in |
| Camera framing | No issue | — |

## 6. Performance

See `performance-3.0c.md` (raw data in `benchmark-3.0c.json`).

- **Vsync on:** 60 fps and p99 16.8 ms for 20, 100, 300 and 1,000 residents, at gameplay zoom and zoomed out, on
  both versions.
- **Uncapped:** 3.0C matches or beats 3.0B (for example 300 residents at 2.04 vs 2.40 ms per frame).
- **Animation JS cost:** 0.6 ms per frame with 80 residents on screen; 1.54 ms with 607 on screen (1,000 total).
- **Software rendering:** equal or better (300 residents: 15.3 vs 12.3 fps).
- **Atlases:** 2.42 MB download and about 48.5 MB of GPU memory (+0.8 MB and +8.6 MB over 3.0B).

## 7. Camera and zoom

Measured on 3.0B: alternating Zoom in / Zoom out from the home view **drifted**. After the first cycle the view
stayed at a different centre and scale (footprint 53.5 → 42.8, centre moved about 1.2 minimap units), reproducing
the reported issue. On this branch the same cycles return exactly to the starting view, and the new e2e test
(`visual-world-3c.spec.ts`) asserts that after eight cycles. I did not deliberately change camera code. The
likely reason is that removing per-frame scene work changed timing between the camera request and the minimap
footprint update. The underlying camera logic is unchanged, so the focused **Camera & Zoom Fix** should still
audit `cameraRequest` handling (zoom around the safe-area centre, follow mode, resize). Character visibility and
building and resident selection after zooming are covered by tests.

## 8. Tests

| Suite | Result |
|---|---|
| Typecheck | pass |
| Frontend unit | **173 passed** (3.0B: 148; +25) |
| Simulation | 286 passed |
| AI Architect | 52 passed |
| API (pytest) | 66 passed |
| Security scan | 0 findings |
| Production build | pass |
| Playwright e2e | see §9 (46 tests; 3.0B had 42) |

**New unit tests** (`art/characters.test.ts`, `atmosphere.test.ts`):
- The atlas has every frame for every appearance combination (150 combinations × facings × poses × frames).
- Saved choices map exactly to layers and colours, and layer order is correct.
- Resident looks are deterministic, survive JSON round trips and vary across the population.
- Walking follows displacement (8 frames per stride, not time); idles don't sync; waving, talking and sitting map
  correctly; reduced motion holds still.
- All four headings map to the right facing.
- The rig hides only missing layers, and the vector fallback works without art.
- Residents build after zoom cycles; night lift works; interactions come only from real player state.
- Lot-aware depth.
- 300 residents update within budget.
- Lighting has no jumps minute by minute; dayparts are distinct; night stays readable; window life is
  deterministic.
- Venue crowds show only real visitors, are bounded, deterministic and inside the venue, keep clear of
  centrepieces, swap axes for east-facing venues, and pair conversations properly.
- Ambient particles are bounded and freeze under reduced motion.

**New e2e tests** (`visual-world-3c.spec.ts`):
- Baked residents are visible and selectable, and zoom cycles don't drift.
- Real park visitors are drawn.
- The Character Creator shows the baked preview, updates it with choices, and the map stays the only canvas.
- Under reduced motion, a paused frame is pixel-stable.

**Changed assertions:** none in existing tests.

## 9. Known limitations

1. **Procedural characters.** The figures are modelled in code from rounded primitives and baked. They're
   cohesive and charming at game zoom, but simpler than hand-sculpted commercial characters (no cloth folds, simple
   hands, generic faces).
2. **Two baked facings** (front and back), mirrored for the other two. There are no diagonal or side profiles.
3. **Venue capacity on screen:** up to 12 park, 10 pool and 6 terrace figures per venue. Extra real visitors stay
   inside, as before.
4. **The baked sun direction is fixed;** shadows don't rotate through the day (hybrid approach).
5. **Night light pools are additive ellipses,** not true lighting, and nothing reflects in water.
6. **Schedules still make cities quiet** at midday and late at night. That's simulation behaviour for Phase 7.
7. **Camera drift on 3.0B** isn't reproducible on this branch with button zoom, but the camera code wasn't
   audited. It's handed to the focused Camera & Zoom Fix.
8. **GPU memory** is +8.6 MB (character atlas).

## 10. Phase 7 hooks

- `VENUE_PROFILES` (`venueCrowd.ts`) holds crowd spots and actions per venue.
- `VENUE_FX` (`ambientLayer.ts`) holds light pools, sparkles, fireflies and reserved `stageLights` per venue.
- `selectPose` and the rig can take new poses (for example eating, shopping, dancing) when the simulation gains
  those activities.

The café, shopping street, concert stage, night market, cinema, amusement park, music club and performance plaza
plug in through these without renderer changes.
