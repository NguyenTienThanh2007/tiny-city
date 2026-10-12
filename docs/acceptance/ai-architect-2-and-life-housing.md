# Acceptance — AI Architect 2.0 and Life Mode housing fix

Branch `feature/ai-architect-2`, created from `origin/main` @ `131f1df` (Phase 4 merged as #10).

## AI ARCHITECT 2.0 ACCEPTANCE

**Status: not started — not accepted.** The AI Architect 2.0 requirements referenced by the housing addendum ("all
previous AI Architect 2.0 requirements") were never provided in this session. No AI Architect behavior was changed on
this branch, and none is claimed. The existing Phase 2 AI Architect still passes its regression suites: architect
unit tests 31/31, API 61/61, and the `ai-architect` e2e spec as part of the 35/35 run. The Life Mode e2e also
covers an AI preview and approval with a character present.

## LIFE MODE HOUSING ACCEPTANCE

### Root cause (reproduced, not assumed)

- **Engine:** reproduction in `packages/simulation/tests/playerHousing.test.ts` ("reproduces the
  bug"). A populated street with every room taken stays fully booked even after a new villa is built.
- **Browser:** a temporary Playwright reproduction on the unfixed code showed three things:
  - after building a villa, the new home held 2/2 residents;
  - the saved world had no player;
  - Life mode asked to create the character again, and every home was still Full.
- **Causes:**
  1. *Welcome residents* uses a population cap of 1000, far above housing, so every room fills.
  2. Every city command re-runs `reconcilePopulation`, which immediately filled any newly built home, so "Build a
     home" was a dead end.
  3. The character draft existed only in React state, so leaving to build lost it.

### Fix

- **Unplaced characters.** `player.create` without a home creates the character with movement status `unplaced`.
  - It is validated, saved and reloaded, never rendered, and never progresses needs.
  - `player.move-in` is its spawn.
- **Held room.** While a player has no home (unplaced, or after losing it), population reconciliation stops creating
  *new* residents when one free room remains.
  - Existing residents are housed first, so the hold never displaces, evicts or re-homes anyone.
  - Capacities are unchanged, and allocation stays deterministic in building-ID order.
- **Placed players** keep the existing rule: their home counts one room for them (`capacity − 1` for residents).
- **UX:**
  - The picker explains full housing with real counts and offers **Build a home**.
  - The character is saved and waiting; a **Back to home selection** chip and the Life tab lead back.
  - A notice names the home that now has a free room, and new homes get a **New** chip and gold halo.
  - Availability refreshes after every city change, and the phone layout keeps the map visible while building.

### Criteria

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Character creation works | Pass | Unit, App and e2e tests |
| 2 | Full housing handled correctly | Pass | Recovery region with real counts; the character is kept (App and e2e tests) |
| 3 | Player can build or obtain valid housing | Pass | e2e builds a villa from the recovery flow; AI batch unit test |
| 4 | Residents don't consume the reserved place | Pass | Repeated reconciliation, re-enable, road edits, undo/redo (unit); 1 of 2 rooms taken in the new villa (e2e) |
| 5 | Player can move into a valid home | Pass | e2e (desktop and phone) |
| 6 | Player spawns | Pass | e2e: Welcome notice, Life HUD, inside the new villa |
| 7 | Player can walk and interact | Pass | e2e walk after recovery; existing journey still meets a resident |
| 8 | Save/reload preserves housing | Pass | e2e reload gives an identical player; unit round-trip of the unplaced state |
| 9 | No silent displacement | Pass | Every original resident keeps their home (unit and e2e); demolition removes only that home's residents |
| 10 | Capacity and invariants | Pass | `validateWorld` and per-home capacity checks after every step in `playerHousing.test.ts` |
| 11 | Browser e2e passes | Pass | 35/35 (2 new housing journeys) |

Also covered:
- apartment builds (23 residents and the player);
- normal filling after the player moves in;
- homes moved;
- demolition of the player's home followed by reassignment;
- undo/redo of the new home;
- AI batch building then move-in;
- legacy fully occupied saves (no character created);
- a character created before residents arrive (room reserved up front).

### Test results (2026-10-12)

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm test` | 123 passed |
| `npm run test:simulation` | 270 passed (9 new housing tests) |
| `npm run test:architect` | 31 passed |
| `npm run security` | 0 findings |
| `npm run build` | Pass |
| API pytest | 61 passed |
| `npm run test:e2e` (mock Gemini) | 35 passed (2 new housing journeys; full-housing test updated to the kept-character behavior) |

Screenshots (reviewed): `docs/life/screenshots/16-no-free-home.jpg`, `22-recovery-build-mode.jpg`,
`23-recovery-new-home.jpg`, `24-recovery-moved-in.jpg`.

### Limitations

- Recovery needs new housing: by design, nobody is moved out. An explicit, user-approved resident relocation was not
  added.
- The held room is one room city-wide, kept in the last home that has space in building-ID order. The player may
  pick any free room.
- There is no "delete character" action; a waiting character stays until it moves in.

### Overall

Not accepted overall: the Life Mode housing fix passes, but AI Architect 2.0 has not been implemented because its
requirements were not provided.
