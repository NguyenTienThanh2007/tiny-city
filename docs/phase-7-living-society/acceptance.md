# Acceptance: Phase 7

- **Baseline:** `main` at `2838fdd1b0f960e39e1a1601a58272517c848271` (Phase 6 merged; its PR passed every check).
- **Branch:** `feature/p7-living-society`.
- **PR:** [#24](https://github.com/NguyenTienThanh2007/tiny-city/pull/24). Draft until every check passes; never merged without explicit approval.

## Criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Citizens have stable personalities | Met | Five traits and two interests, hashed once from identity and stored. Unit test: identical after a week of play and across save/load. |
| 2 | Personalities influence decisions | Met | Utility factors per trait (personality-and-decisions.md). Chosen activities match the chooser's interests far more often than chance (unit). A thrifty, short-of-money resident picks only free activities (unit and browser D). |
| 3 | Relationships persist and change logically | Met | They grow only from time together, with a daily cap, bounds, fading and reconciliation. Browser B: coworkers become friends at lunch, the feed says so, and it survives reload (L). |
| 4 | Daily routines are diverse | Met | Staggered decision slots, personal offsets and lengths, needs and traits. Unit: decisions spread over many minutes. 8+ activity kinds in a week. |
| 5 | Weekends are meaningfully different | Met | No work on days off. Saturday outings exceed 1.5× Monday's, with daytime outings (unit). Browser: Saturday shopping-street sales. |
| 6 | Residents visit real leisure venues | Met | Every outing is a real trip to a real venue, charged on arrival, within opening hours (fuzz invariant). Browser A/C. |
| 7 | Shopping and dining affect the real economy | Met | Purchases become business sales equal to the residents' spending, never waived (unit and fuzz). Browser C/F. |
| 8 | Social travel uses real transportation | Met | Travel estimates by walk, car or bus; the Phase 6 planner picks the mode. Unit: outing trips include cars. Browser E: cars parked at venues. |
| 9 | Community events attract real participants | Met | City calendar and player events. Attendees are residents who arrived, once each. Browser G. |
| 10 | Capacity constraints work | Met | Presence never exceeds capacity (validation and fuzz). A crowd turns the overflow away (unit). Event attendance within capacity (browser H). |
| 11 | Nightlife and entertainment are visible | Met | Baked venues, venue crowds, cheering audiences, venue lights by opening hours. Screenshots 01–04 and 09–10. |
| 12 | Citizen profiles explain behaviour | Met | The Social life card shows personality, interests, wellbeing, the outing and why ("Weighed 12 options"). Browser J; screenshot 06. `explainDecision` debug API. |
| 13 | Life Mode interacts with the society | Met | Visit open venues, eat out at a café or market, event bonus, chats lift residents (unit). Browser Q: the player eats at the bistro. |
| 14 | New buildings work with the AI Architect | Met | EN/VI aliases, entertainment district, classic models. Unit: planned at catalog cost. Browser P: Vietnamese plan previewed, approved, undone and redone. |
| 15 | Save/load preserves social state | Met | Exact round trip mid-outing (unit). Browser L: reload identical. |
| 16 | Existing worlds migrate safely | Met | Personalities on enable, no relationships, nothing replayed, IDs, money and RNG untouched (unit). |
| 17 | Deterministic simulation remains intact | Met | RNG-free society. Byte-identical replays across frame chunking, 4× vs 1×, save/load (unit) and browser Step vs engine replay (N). Fuzz seed replays identically. |
| 18 | Camera, economy and transport remain stable | Met | Phase 4.6 camera, Phase 5 economy and Phase 6 transport suites in the full run. The economy panel shows city events (browser R). |
| 19 | Large-city performance is acceptable | Met | 1.45 ms per tick at 896 residents; about 59 fps in the browser ([performance.md](performance.md)). |
| 20 | Automated tests pass | Met | See below. |
| 21 | Browser acceptance passes | Met | `e2e/phase-7-society.spec.ts` 4/4 and the city-builder venue tests 8/8 locally, plus the full suite (see below). |
| 22 | All GitHub Actions jobs pass | Pending | Recorded on the PR. |

## Test results

| Suite | Result |
|---|---|
| Typecheck (all packages, app, e2e) | Pass |
| Simulation (Vitest) | 422 passed, including the society suite (30 tests) and the society fuzz (4 seeds; wide sweep 30 × 120 passed) |
| Frontend (Vitest) | 245 passed, including the society view, feed, crowd and lighting tests |
| AI Architect | 78 passed, including venue interpretation and planning |
| API (pytest `-W error`) | 81 passed |
| Production build, secret scan | Pass; 0 findings |
| Playwright full suite (CI mode, 2 shards, 80 tests) | Shard 1/2: 42/42 passed (10.9 min). Shard 2/2: 36/38 in the first run. The two failures were older specs that encoded behaviour Phase 7 deliberately changed: everyone home at 21:00, and jobs filled in building-ID order. Both were rewritten to check the new rules precisely (anyone away from home must be on a recorded outing; the office must settle exactly by the office rule) and pass. |

Browser scenarios A–T:

| Scenario | Where it is checked |
|---|---|
| A, C, D, J, M, N | Weekday-evening test |
| B, E, G, H, I, K, L | Friday test |
| F, O, R | Saturday test |
| P, Q | AI Architect and Life test |
| S (transportation routes) | Phase 6 spec |
| T (authentication and cloud save) | `guest-session` and `account-cloud-saves` specs in the full run |

## Screenshots (Coral Bay Nights, real browser)

All captures come from `node scripts/capture_p7.mjs`. Peak counts at each moment are in [`screenshots/evidence.json`](screenshots/evidence.json).

| | |
|---|---|
| 01 Café after work (Monday): 7 at the Corner Café terrace | 02 Shopping street (Saturday morning): 5 shoppers |
| 03 Friday concert: 11 attending at the Bayside Stage | 04 Night market (Saturday festival night): 39 present |
| 05 Cinema inspector during a screening: 4 watching | 06 Resident profile: personality, wellbeing, outing, reasons |
| 07 Event calendar and Living society card | 08 City Life feed |
| 09 Nightlife: club neon, market lanterns, marquee | 10 The whole entertainment district (Saturday afternoon) |
| 11 Phone: Living society in the bottom sheet | 12 Organizing an event at the plaza (booked and validated) |

## Known limitations

- **Distance and neighbourhoods.** Distance matters at this map's scale. Residents more than about 90 minutes away (on foot, by their own car or by bus) never consider a venue. Coral Bay's old town therefore uses its own parks, pool and clubhouse, and the entertainment district serves its own neighbourhood. The cinema (peak 4), shopping streets (peak 5) and amusement park (peak 2) are niche there, drawing mainly residents with matching interests; the cafés, night market and events draw crowds.
- **Small-town economics.** Venue businesses often lose money in small towns. Owners outside the city cover it, the status reads "Weak demand", and the city keeps the jobs, wages and commercial tax.
- **Relationships between residents only.** The player keeps the Phase 4 acquaintance list; chatting lifts the resident's social need but does not create a resident-to-player relationship.
- **Player money.** The player has no account, so eating out or visiting is free for the player.
- **What is drawn.** Indoor venues (cinema, music club) and friends' homes are not drawn from inside; the inspectors count their visitors. Crowd spots per open-air venue are finite (up to 37 at the stage), and extra visitors stay inside, as in Phase 3C.
- **AI Architect scope.** The planner builds venues but does not schedule events. Events are booked from the venue inspector, so the AI never touches relationships or attendance.
- **One design per venue type** in the Classic Coastal collection (two for the café). Other architecture collections have no venue models yet: a named style that lacks them is refused, while an implied "modern" keeps venues classic.
