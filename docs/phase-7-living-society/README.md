# Phase 7: Living Society

Residents now have stable personalities, needs and interests. They make their own plans for evenings and weekends: a meal at a café after work, a walk in the park, the night market, a concert, a friend's home. They make friends from time actually spent together, go out in groups, attend city events, and spend real money at real businesses. Everything on screen is a real resident doing what the simulation says.

| Doc | What it covers |
|---|---|
| [social-architecture.md](social-architecture.md) | State, tick order, how society plugs into Life, transport and the economy |
| [personality-and-decisions.md](personality-and-decisions.md) | Traits, interests, needs, the utility model, schedules and weekends, explanations |
| [relationships.md](relationships.md) | The friendship graph: how bonds form, fade and stay bounded |
| [leisure-and-venues.md](leisure-and-venues.md) | The eight new venues, hours, capacity, staffing, attendance, art and crowds |
| [events.md](events.md) | The city calendar, player-organized events, attendance and cancellation |
| [economy-integration.md](economy-integration.md) | Purchases, tickets, event costs, venue businesses, ledger rules |
| [transportation-integration.md](transportation-integration.md) | Travel estimates, mode choice, trip cancellation |
| [persistence-and-migration.md](persistence-and-migration.md) | Saves, older worlds, undo/redo, reconciliation |
| [performance.md](performance.md) | Measured benchmarks |
| [acceptance.md](acceptance.md) | Criteria, evidence, test counts, known limitations |
| [screenshots/](screenshots/) | Real browser captures |

## In one paragraph

`WorldState.society` is optional and versioned (schema 2 is unchanged). It is owned by the simulation package:

- `societyConfig.ts` holds every constant.
- `society.ts` holds state, personalities, validation, reconciliation, the calendar and the player's event commands.
- `societyStep.ts` holds the per-tick engine.

Each tick, society runs before Life (calendar, event status, decisions) and after transport (arrivals, charges, endings, needs, time spent together). A decided outing reaches the rest of the game only through Life's override. Life walks the resident to the venue, and Phase 6 transport may drive them or put them on a bus. Nothing is teleported, and nothing is decided by randomness alone. The decision engine is RNG-free, so enabling society never shifts the world's random sequence: Phase 3–6 replays and worlds without society are byte-for-byte unchanged.

## How to see it

- Every city now has a living society. Older saves give residents their personalities on load and replay nothing.
- **Live panel:** the Living society card (people out now, outings, event attendance, wellbeing, popular places) and the event calendar.
- **City Life feed:** friendships, events, group outings and full venues.
- **Resident profile:** personality, interests, wellbeing, the current outing, *why* it was chosen, and friends.
- **Venue inspector:** hours, visitors against staffed capacity, price, events, and booking an event.
- **Build catalog:** the Entertainment group holds the café & restaurant, shopping street, night market, cinema, music club, concert stage, performance plaza and amusement park.

## Tools

- `node scripts/capture_p7.mjs [url] [outDir]` produces the browser evidence for Coral Bay Nights (`scripts/p7_city.mjs`).
- `node scripts/p7_benchmark.mjs` runs the headless week-long benchmark.
- `SOCIETY_FUZZ_SEEDS=30 SOCIETY_FUZZ_STEPS=120 npm test --workspace @tiny-city/simulation -- tests/societyFuzz.test.ts` runs a wide fuzz sweep.
- `explainDecision(world, navigator, citizenId)` is a debug API. It returns every option a resident would weigh right now, with its full factor breakdown.
