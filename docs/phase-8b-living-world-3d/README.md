# Phase 8B: Full living world in 3D

Phase 8A put your character in a 3D neighbourhood. In Phase 8B the Character View becomes the whole living city. Every building, road, stop and piece of landscaping is in it. Every resident, car and bus you meet is the simulation's own, and they keep doing what the simulation says: commuting, waiting at stops, riding buses, eating at cafés, cheering at concerts. You can walk up to anyone or anything and press **E** to inspect it. The day turns to night on the game clock, and the city keeps changing while you explore it. There is still one world, one clock and one simulation. The 3D view only reads it, and moves the character through validated commands.

| Doc | What it covers |
|---|---|
| [shared-scene-architecture.md](shared-scene-architecture.md) | The world scene model, the incremental city scene, actors, the frame loop and the single clock |
| [entity-reconciliation.md](entity-reconciliation.md) | Stable IDs, hydration, diffs, the kept scene between visits, collision after edits |
| [world-geometry.md](world-geometry.md) | Building types, roads, stops, landscaping, distance levels (near / mid / far / off) |
| [npc-rendering.md](npc-rendering.md) | Which residents are drawn and where, sidewalks, poses, pooling, interaction |
| [vehicle-rendering.md](vehicle-rendering.md) | Cars, vans and buses from the transport simulation, passengers, lamps |
| [social-activities.md](social-activities.md) | Venue visitors, events and concerts from real attendance |
| [time-and-lighting.md](time-and-lighting.md) | Sky, sun, street lamps, windows and venue light from the game clock; pause and speed |
| [performance.md](performance.md) | Benchmarks at about 20 / 100 / 300 / 1,000 residents, hardware and software rendering |
| [browser-acceptance.md](browser-acceptance.md) | Criteria, scenarios A–U, tests and CI |
| [limitations.md](limitations.md) | What is not in 8B and what comes next |
| [screenshots/](screenshots/) | 16 real browser captures and 6 motion videos, with per-capture evidence |

## In one paragraph

`src/immersive/world/sceneModel.ts` translates the authoritative `WorldState` into stable scene entities. It is pure and deterministic. Buildings are keyed by ID, road tiles by position, stops by ID, landscaping by 12-tile chunk; residents become `walking` / `waiting` / `at-stop` / `at-venue` or are counted as hidden (inside, on a lot, riding, driving); vehicles are those on the road; and E-targets always point at a real record. `three/cityScene.ts` reconciles a Three.js scene against that model. It applies only the diff and is kept between visits. Distance levels make any city size affordable: the detailed model near, a one-material model mid-range, instanced massing far out. `three/actors.ts` draws the nearby residents (skinned bake characters from `citizenLook(id)`) and vehicles (instanced per model and colour). Both only interpolate between ticks. `InspectPanel.tsx` shows the live record through the City View's own view models. `engine.ts` runs the frame: advance the one clock, reconcile on plan or stop changes, move the character, sync the actors, set the light, render.

## How to try it

1. Life Mode: create a character with a home beside a road, then **Enter World**.
2. Press **Resume** (or Space). Change speed with **1× / 2× / 4×** in the clock card.
3. Walk with W A S D (Shift runs). Residents, cars and buses go about their day around you.
4. Face a resident, a building or a bus stop and press **E**. Greet or chat with residents, visit a venue, eat at a café: these are the same Life Mode commands as in the City View. Esc closes the panel.
5. **Return to City** to build or demolish, then **Enter World** again: the 3D city has caught up.

## Tools

- `scripts/p8b_city.mjs`: `livingCityAt(minute, {at})`, Coral Bay Nights at any minute. The player can already be standing at a tile, having walked there with the real `player.move-to` command.
- `scripts/p8b_bench_cities.mjs`: the four benchmark cities (19 / 103 / 299 / 995 residents). Running it validates every lot.
- `node scripts/capture_p8b.mjs [url] [outDir] [--only=01,motion]`: screenshots and motion videos.
- `node scripts/p8b_benchmark.mjs [url] [--quick] [--software] [--only=small]`: benchmark.
- `e2e/phase-8b-living-world.spec.ts`: browser acceptance on the `LIVING_TOWN` fixture (`src/immersive/world/livingFixture.ts`).
- `window.__tinyCityImmersive`: drawn residents and vehicles (with IDs), hidden counts, entities, the E target, sky, and renderer stats (near / mid / far buildings, reconciles, the last sync, sim / sync / render time).
