# Leisure and venues

## The eight new venues

All of them use footprints the city builder already supports (rectangles from 2×2 to 6×5), need road access, and appear in the Build catalog under **Entertainment**.

| Venue | Footprint | Cost | Kind | Jobs | Visitors | Hours | Price | Activity |
|---|---|---|---|---|---|---|---|---|
| Café & restaurant | 2×2 | $260 | business | 4 | 16 | 07:00–23:00 | $8 | Eat out (hunger +22/15 min) |
| Shopping street | 4×2 | $520 | business | 8 | 30 | 09:00–21:00 | $8 | Shopping |
| Night market | 4×3 | $300 | business | 6 | 40 | 17:00–01:00 | $6 | Food and stalls (hunger +14) |
| Cinema | 3×3 | $700 | business | 6 | 40 | screenings 13:00, 16:00, 19:00, 21:30 (2 h) | $9 | A film |
| Music club | 3×2 | $420 | business | 5 | 30 | 20:00–02:00 | $9 | A night out |
| Concert stage | 4×4 | $600 | city | — | 80 | events only | ticket per event | Concerts, performances |
| Performance plaza | 3×3 | $240 | city | — | 40 | 08:00–23:00 | free | Hang out; performances, movie nights, festivals |
| Amusement park | 6×5 | $1,400 | business | 12 | 60 | 10:00–22:00 | $14 | Rides |

The Phase 3–6 park, pool and clubhouse are society venues too, with hours, effects and their Phase 5 fees. Friends' homes host visits, one visitor at a time.

Every constant is in `packages/simulation/src/societyConfig.ts` (`VENUES`) and `catalog.ts` (cost, footprint, jobs or visitors).

## Staffing

Businesses serve in proportion to their staff: ceil(visitors × (workers + 1) / (jobs + 1)). The owner alone keeps a few tables open, and a fully staffed café serves 16. The venue inspector shows "N / M visitors now (16 when fully staffed)".

With society on, new hires join the **least-staffed** workplace (the lowest share of its jobs filled, ties by ID) instead of the first one with a vacancy. Without that rule, a mature city's offices would take every new resident and new venues would never be staffed. Residents who already hold a job keep it, and worlds without society keep the original rule exactly.

## Real attendance

A visit goes through every step of a real trip:

1. The resident chooses an activity and a reachable, open venue with room.
2. The outing is reserved. Capacity counts every resident with an outing there plus the player while visiting.
3. They leave when they must: now, or in time for an opening, a screening or an event.
4. Life routes them on the roads. Phase 6 may drive them in their own car or put them on a bus.
5. On arrival (inside the venue, for leisure), the outing becomes **present**, is charged **once** (the amount is stored on the outing), and counts as a visit. Arriving early means waiting at the door: they are present and charged only once the venue opens.
6. Needs change each period while there.
7. At the outing's end time they leave. Life sends them home (or to bed), and companions grow closer.

An outing is cancelled (`society.outing-ended`, result `cancelled`) when:

- the venue is demolished;
- an event is cancelled;
- no road connects them any more (`unreachable`);
- they cannot get there in time (`late`);
- the friend they were visiting left home.

The resident then simply carries on with their schedule. Presence never exceeds capacity: `validateSociety` asserts it, and the fuzz test checks it after every few ticks.

## What is drawn

- Visitors of open-air venues are drawn at authored spots: the café terrace, the shopping pavement and benches, the market stalls and tables, the stage lawn, the plaza and the amusement park. This is `src/game/venueCrowd.ts`, one figure per real visitor up to the visible spots.
- Companions on one outing take neighbouring spots (one table, one conversation).
- Audiences cheer (the wave pose) while an event runs at the stage, plaza or market.
- Cinema and music-club visitors are indoors and are not drawn outside. The venue inspector counts them.
- Nothing is invented: there are no decorative crowds.

## Art

The venues are baked 3D sprites, built procedurally with Three.js in `scripts/art/assets/venues.js` and baked into the `venues` atlas, with both facings and two café designs:

- the corner café with its awning and terrace, and the garden bistro under a pergola with string lights;
- the shopping arcade with four lettered shopfronts;
- the night market with lantern-lit stalls, a food truck and an arch;
- the art-deco cinema with a lit marquee and ticket kiosk;
- the brick music club with neon and a rooftop lounge;
- the band-shell concert stage with light towers and a lawn;
- the fountain plaza with its platform;
- the seaside fun park with a Ferris wheel, a carousel and a coaster.

The night pass gained coloured glow (`userData.glow`) for neon, lanterns, marquee bulbs and stage lights, and venue lights follow their real opening hours (`windowsOn`). The night market lights up only from 17:00, for example. Existing atlases are byte-identical after the re-bake. Each venue also has a vector fallback and a hit-test height.

## The resident's view of a venue

The venue inspector shows:

- open or closed now, and the hours (or screening times);
- visitors now against the staffed capacity;
- the price and today's visits;
- a "no workers yet" warning when unstaffed;
- the venue's events, with event booking where it can host them (see events.md).
