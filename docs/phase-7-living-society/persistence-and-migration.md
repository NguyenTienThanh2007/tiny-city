# Persistence and migration

## Saves

`WorldState.society` is part of the world snapshot, so it is saved in every place the world is:

- local saves (`saveVersion: 3` with the simulation snapshot);
- cloud saves (the same JSON, well under the API's size limit);
- guest and account sessions alike.

`serializeWorld` and `deserializeWorld` round-trip it exactly, and `validateWorld` checks it on every load. A save taken while residents are out reloads mid-outing, and continuing gives a state identical to never having saved. This is checked by a unit test and by browser test L ("reload keeps relationships, outings and events exactly").

## Older worlds

The frontend enables society for every city (`createCityWorld` for new cities, `enableSociety()` on load). For a Phase 6 (or older) save:

- every resident gets a personality, interests and starting needs, from their identity;
- no relationships are created, and they grow from play;
- the calendar starts from the current day, with future events only. Nothing is replayed for time that has passed: no retroactive outings, events or charges;
- IDs, homes, jobs, money and the world's random state are untouched (unit test "migrates a Phase 6 world").

`enableSociety` is idempotent. Worlds without society never run society code and keep their exact Phase 6 behaviour, including the original job assignment rule.

## Undo, redo and city edits

- History (`CitySnapshot`) does not include the society. Like transport, social life is not rewound.
- After any edit, undo or redo, `reconcileSociety` repairs references:
  - outings to removed venues end;
  - events at removed venues are cancelled;
  - departed residents' profiles and relationships go;
  - new residents get profiles.

## Bounded size

| Part | Bound |
|---|---|
| Profiles | One per resident, about 400 bytes of JSON |
| Relationships | At most 10 per resident, about 60 bytes each |
| Events | At most 40 |
| History | 7 days |
| Recent venues | 4 per resident |

At about 1,000 residents the society adds roughly 0.45 MB to the save (measured in performance.md). A unit test keeps the society's share under 700 bytes per resident in the test town.

## The AI planner

Planner requests omit the society (`plannerWorld`), together with the economy and transport. Residents out at a café or a friend's home are sent as idle visitors there. The AI never reads or writes relationships or attendance.
