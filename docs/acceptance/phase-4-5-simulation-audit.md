# Phase 4.5: simulation and gameplay stabilization audit

Branch `feature/p4-5-simulation-audit`, 2026-10-12/13. This phase finds and fixes correctness defects. It does not
redesign the game, start Visual World 3.0 or begin the Phase 5 economy.

## Starting baseline

| Item | Value |
| --- | --- |
| `origin/main` | `efcfcf9` (merge of PR #12, AI Architect 2.0; PR #11 housing fix merged before it) |
| Existing `origin/feature/p4-5-simulation-audit` | Identical to `efcfcf9`: no commits, no PR. Reused, not recreated. |
| Working tree | Clean apart from the untracked, never-committed `.claude/` |
| Baseline results (end of AI Architect 2.0) | typecheck pass · unit 127 · simulation 270 · architect 52 · API 66 · e2e 39 (40 with the CI flake fix) |

## Method

1. **Seeded invariant suite** (`packages/simulation/tests/invariants.test.ts`).
   - It mixes random city commands, two-command AI-style batches, undo through `restoreCity`, save/load through
     `serializeWorld`/`deserializeWorld`, ticks and Life commands, as the frontend does.
   - It checks every invariant below after every step.
   - CI runs 8 seeds × 220 steps. The audit also ran up to 80 seeds × 500 steps locally (`AUDIT_SEEDS`, `AUDIT_STEPS`).
2. **Real-browser reproduction** with Playwright against the running app (see screenshots).
3. **Test first:**
   - Each confirmed bug has a focused regression test that failed before the fix. The failure was demonstrated by
     temporarily restoring the old code or stashing the fix.
   - Then the fix, then the affected suites, then the full suite.

## Invariants (now tested)

| # | Invariant | Where |
| --- | --- | --- |
| I1 | Occupied rooms = assigned residents + the housed player. Free rooms = max(0, capacity − occupied). Never over capacity, never negative. | `validateWorld`/`validatePlayer`, invariant suite, `playerHomeOptions.occupied/freeRooms`, `housingSummary.occupied` |
| I2 | A resident at work or out still occupies their home. Visitors never take a room. | `getBuildingOccupancy` (residents by assignment, visitors only inside leisure venues), `housingView.test.ts` |
| I3 | Home options, the housing summary and raw state agree. The player is counted exactly once. | invariant suite |
| I4 | A walking resident stands on a road, or on the entrance leg of the building it is leaving or entering. Never inside a foreign building. | invariant suite (new); `validateWorld` checks routes |
| I5 | Visitors only fill public venues, within capacity. | `validateWorld`, invariant suite |
| I6 | Identical seeds and commands give byte-identical worlds. | invariant suite (determinism) |
| I7 | Save/load is lossless: continuing 400 ticks after a reload equals continuing without one. | invariant suite |
| I8 | City edits keep every still-valid home and job assignment. | invariant suite |
| I9 | Unique, stable IDs; the citizen cursor exceeds every ID; references exist. | `validateWorld` (after every command) |
| I10 | Nobody stays out at 03:00 when a route home exists. | invariant suite (liveness) |
| I11 | The player holds one room, is never auto-created, is reconciled after every edit, and history never rewinds them. | existing Phase 4 tests plus suite |

## Confirmed bugs

| # | Severity | Bug | Root cause | Regression test | Final behavior |
| --- | --- | --- | --- | --- | --- |
| B1 | **High** (the user report) | After creating a character, homes read "0 of 2 rooms taken" although residents live there. The player's own full home read "1 of 2". | Two defects. (a) Every occupancy view counted NPC residents only: `playerHomeOptions.residents`, the building inspector, the housing meter. The housed player was never added. (b) In a city where residents were not yet welcomed, the picker truthfully said "0 of 2", but "Move in & start" (with "welcome residents" checked by default) immediately filled every other room. The confirmation promised "you will take one" and nothing about roommates. Reproduced in the browser (sample city: all villas "0 of 2"; after move-in the player's villa showed "1 of 2" while the engine had 1 resident + the player). | `housingView.test.ts` (reproduces the report), invariant suite I1/I3, `HomePicker.test.tsx`, e2e `phase-4-5.spec.ts` | One rule everywhere: occupied = residents + housed player. Home list "2 of 2 rooms taken (incl. you)". Inspector "2 / 2 rooms taken · 1 resident + you · 0 free rooms", with the player listed as "You · Resident". The picker says no one lives there yet and how many residents will share the home and live in the city (`projectWelcome`, a dry run of the real engine). |
| B2 | **High** (crash) | A city edit (any road, build, demolish or move) while a resident walked out of their workplace toward a park or clubhouse threw `RangeError: invalid leisure destination role`. The edit failed with an exception. | `reconcilePopulation` treated a walker on a building's entrance leg as *inside* that building with the **destination's** arrival activity ("leisure inside a mall"), which `validateWorld` rejects. Found by the invariant suite (seed 11, step 65: demolishing a clubhouse while mall workers walked to it). | "a city edit while a resident walks out of work…" (failed with the RangeError before the fix) | A resident stopped on an entrance leg is inside only a building that is theirs (home or work), or the venue they were entering. They do what that building is for. Otherwise they stop on the leg and re-route. |
| B3 | **Medium** | A resident whose road tile was removed mid-walk waited on the grass forever. A building restored by undo on top of a walking resident trapped them "inside" a building that isn't theirs. | Routing starts from a road tile or the building the resident is inside. From open grass or a foreign building there is no start, so every tick re-planned and failed. The old rule "wait without teleporting" only worked if the exact tile came back. | "a resident whose road tile is removed mid-walk… still arrives" (never arrived before) and "a building restored by undo on top of a walking resident…" (failed I4 before) | After any city edit or undo, a walker that is off the network steps to the nearest road tile (radius 8, the player's rule), or goes home when no road is close, and re-routes. The adjacent step is at most about one tile. The browser test bulldozes the tile under a walker, who steps onto the street and still reaches the office. |
| B4 | **Medium** (liveliness) | Evening leisure filled the first venue by ID. In the sample city all 20 residents went into the clubhouse (capacity 20) and the park stayed empty; pools were never used while earlier venues had room. | `advanceDailyLife` chose `leisure.find(hasRoom)` over venues sorted by ID. | "evening leisure spreads across public venues…" (only club and park were used, never the pool, before the fix) | Each resident has a deterministic personal ranking of venues (rendezvous hash of resident and venue IDs) and falls through it while a venue is full. Custom schedule targets and an already-reserved venue still win. The browser shows Coastal Park with 4 visitors at 18:50 (screenshot 07). |
| B5 | **Low** | In the Move home flow with no other free home, the card told an already-housed player that "one room is kept free" for them and that they were "saved and waiting". | The recovery card's copy was written for a waiting character and shown for both flows. Found while reviewing screenshots. | `HomePicker.test.tsx` "moving home with nowhere free…" (failed before the fix) | "No other home has a free room… You keep your current home." The waiting-character copy is unchanged. |
| B6 | **Low** (latent) | The home options and housing summary were memoized on `citizens.length`, so an edit that rehoused residents without changing the head count left stale vacancies on screen. | React memo dependencies. | Not reproducible through the UI today: a full city always changes the count when residents move. Fixed defensively. | Memos follow every home assignment (`assignmentKey`). |

A test-only defect also surfaced: the e2e CI flake from PR #12 (a nearby-residents list re-sorting between read and
click) was already fixed in `7233123`.

## Design gaps (documented, not built in this phase)

- **Schedule synchronization.**
  - Generated routines differ only by a ±20 minute offset: wake 06:40–07:20, work, leisure 16:40–17:20, home
    18:40–19:20, sleep. Every day is the same and there are no weekends.
  - This is the "repetitive city" the user describes. Widening the offset or adding variety changes the routine
    contract (`scheduleOffset` is validated to ±20), so it belongs to Living Society.
- **The sample city has no workplaces.** The clubhouse is a leisure venue, not a job. Its residents stay home until
  the evening leisure slot, and the Live panel already says "20 residents have no job. Offices and malls add jobs."
- **Held room vs displaced residents.** When a waiting character's held room exists and a demolition displaces
  existing residents, a displaced resident may take that room: existing residents are never evicted, and they rank
  before the player. A product decision is needed if the held room should be absolute.
- **"Adds N rooms — one is kept for …"** is shown only for an unplaced character. A placed character whose home was
  demolished also has a held room, but the Plan impact does not mention it.
- **Future Living Society 2.0 (Phase 7, after Economy and Transportation):**
  - personality-based decisions and dynamic needs;
  - social relationships between residents;
  - shopping and dining (malls as destinations);
  - concerts and nightlife;
  - weekend routines;
  - community events.

## Working as intended (verified)

- Life Mode housing fix preserved:
  - a character can exist before finding a home and survives reload;
  - a waiting character does not lose needs or spawn early;
  - residents are never evicted;
  - new housing keeps a room;
  - Build → Life keeps creation.
  - Evidence: existing `playerHousing.test.ts` and e2e `life-mode.spec.ts` (housing recovery, desktop and phone), all
    passing.
- AI and manual edits share `applyCityCommand`/`applyCityCommandBatch`, so population and player reconciliation and
  `validateWorld` apply to both. AI 2.0 demolition of the player's home requires explicit authorization, shows the
  impact (home removed, 1 resident leaves), is atomic, and the player is rehoused (new e2e).
  - Stale-revision rejection, undo/redo and save/load of AI plans are covered by the existing architect and e2e suites.
- Pathfinding is bounded and deterministic: BFS node limit, routes per tick, bounded per-plan route cache.
  Navigation indexes rebuild only when the plan changes.
- Gemini is called only for a submitted Plan prompt, never per resident or per tick.
- Legacy and Phase 3 saves load (serialization tests; e2e "Phase 3 saves load without a player").
- Residents at work keep their homes (browser: Palm Villa "2 / 2 rooms taken", both "Resident · At work" at 11:26).
- Residents commute and all return to the same homes by 21:00 (browser).

## Test evidence

| Check | Result |
| --- | --- |
| `npm run typecheck` | see the final run below |
| `npm test` (frontend) | 6 new tests (`housingView.test.ts`, `HomePicker.test.tsx`) |
| `npm run test:simulation` | invariant suite plus 4 regressions; 1 existing assertion updated (see below) |
| `npm run test:architect` | unchanged and passing |
| API pytest | unchanged and passing |
| `npm run test:e2e` | 3 new journeys in `e2e/phase-4-5.spec.ts` |
| `npm run build`, `npm run security` | see the final run below |

**Changed existing assertions** (behavior intentionally changed; nothing deleted or loosened in spirit):
- `npc.test.ts` "waits without teleporting when a road is deleted under its feet" is now "steps to the adjacent road
  without teleporting…". It asserts a step of at most 1.5 tiles onto a road, and resumption.
- `playerHousing.test.ts` exact `housingSummary` now includes the new `occupied` field.

## Browser acceptance (Playwright, real UI)

| | Scenario | Evidence |
| --- | --- | --- |
| A | Populated city: resident counts and names of several homes | `phase-4-5.spec.ts`; screenshots 03, 04, 05 |
| B | Create a player, move in: occupied count rises by one, the player counted once | `phase-4-5.spec.ts`; screenshots 01, 02, 03 |
| C | Full housing, build a home, waiting player moves in | `life-mode.spec.ts` housing recovery (desktop and phone); AI-built variant in `ai-architect-2.spec.ts`; rehousing after demolition in `phase-4-5.spec.ts` |
| D | Residents commute and return to the correct homes | `phase-4-5.spec.ts` (office at 11:00, every resident home at 21:00); screenshot 04 |
| E | Roads modified while characters move | `phase-4-5.spec.ts` (bulldoze under a walker); `living-world.spec.ts` remove/restore; `npc-persistence.spec.ts` |
| F | Demolish the player's home through the approved workflow and reassign | `phase-4-5.spec.ts` AI demolition with authorization and impact, then rehousing |
| G | Save and reload | `phase-4-5.spec.ts`; screenshot 05 |
| H | Build, Plan, Live and Life after the fixes | `phase-4-5.spec.ts` and the full suite |

Screenshots (`docs/acceptance/screenshots/phase-4-5/`, all reviewed):

| File | Shows |
| --- | --- |
| `01-home-picker-projection.jpg` | Sample city before residents: "0 of 2 rooms are taken; you will take one. No residents have moved in yet. Welcoming them fills the other rooms: 1 resident will share this home, and 19 will live in the city." |
| `02-home-list-incl-you.jpg` | Move home: "Villa 01 · 2 of 2 rooms taken (incl. you)", the others "2 of 2 · Full", the corrected card "No other home has a free room · 20 of 20 rooms taken". |
| `03-player-home-inspector.jpg` | Lagoon Villa "2 / 2 rooms taken · 1 resident + you · 0 free rooms", "Mai Nguyen · You · Resident", "Kim 5 · Resident · Asleep at home". |
| `04-residents-at-work.jpg` | 11:26, Palm Villa "2 / 2 rooms taken", both residents "Resident · At work". |
| `05-after-reload-townhouse.jpg` | After save and reload at 21:12: Dune Townhouse "4 / 4", four named residents "At home". |
| `06-evening-leisure-sample-city.jpg` | 18:04: 11 residents walking and 9 at leisure across the sample city. |
| `07-park-visitors.jpg` | 18:50: Coastal Park "4 / 20 visitors now" (before the fix it stayed empty). |

## Performance

`node scripts/p45_benchmark.mjs <dist/index.js>` was run on the same idle machine for `main` (`efcfcf9`) and this branch,
two runs each. Results are in `docs/acceptance/phase-4-5-benchmark-results.json` (second runs). All times are ms.

| Residents | Tick mean (before → after) | Far road edit | Edit stranding walkers | Undo | Serialize | Load |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 0.096 → 0.117 | 1.23 → 1.44 | 0.66 → 0.87 (0 relocated) | 1.2 → 1.3 | 2.0 → 1.7 | 1.8 → 1.9 |
| 1 000 | 0.944 → 0.907 | 14.0 → 15.2 | 8.2 → 22.4 (722 relocated) | 9.1 → 10.3 | 17.2 → 14.0 | 13.3 → 11.9 |
| 3 000 | 3.33 → 3.32 | 91.5 → 82.2 | 46.6 → 83.8 (2 378 relocated) | 46.1 → 53.0 | 50.7 → 59.6 | 58.2 → 57.8 |

- Ticks, ordinary edits, undo and save/load are unchanged within run-to-run noise.
- An edit that strands many walkers costs more. Before, it did nothing and left them stuck forever; now each finds the
  nearest road. The cost is about 16–20 µs per stranded walker, paid once per edit, never per tick.
- The frontend's new assignment key is O(residents) per published world (at most about 10 per second).

## Remaining limitations

- Liveliness beyond the venue spread is a design gap (see above).
- A walker stranded more than 8 tiles from any road is sent home (moved inside it) rather than walking. This can only
  happen after large edits.
- The browser e2e for a road removed under a walker relies on the engine fix. Its failure on the old build was
  demonstrated in the engine regression test, not in the browser.

## Phase 5 readiness

All confirmed defects are fixed with regression tests, and the invariant suite guards the world model that the
Phase 5 economy will extend (budget, buildings, residents, jobs). Recommendation: proceed to Visual World 3.0 and
Phase 5 once CI is green on the PR.
