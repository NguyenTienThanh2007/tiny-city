# Developer B integration

Build dependencies with `npm run build:architect`; run all checks using the root scripts. Import contracts from `@tiny-city/simulation`. Fixtures are exported from `@tiny-city/simulation/fixtures`, including `createLivingWorldFixture()` (30 residents, homes/office/park and connected roads). This headless fixture is not the frontend's coastal land mask; use `createCityWorld(city)` for an existing frontend map.

The existing React hook now exposes `enablePopulation({maxCitizens: 1000})`. Call it once when Phase 3B is enabled. Existing Phase 1/2 UI worlds remain in legacy mode until this explicit activation. Existing managed saves restore automatically and the hook's world includes citizens. Never construct a second Simulation beside the current hook. NPC visuals, sprites, hit-testing and interaction UI belong to Phase 3B.

```ts
import { Simulation, serializeWorld, deserializeWorld } from '@tiny-city/simulation';
import type { Citizen, Position } from '@tiny-city/simulation';
import { createLivingWorldFixture } from '@tiny-city/simulation/fixtures';

const simulation = new Simulation(createLivingWorldFixture());
simulation.resume();
function frame(elapsedMs: number) {
  const result = simulation.advance(elapsedMs);
  for (const citizen of result.state.citizens) {
    // Project tile coordinates using the existing isometric transform.
    // movement.currentBuildingId identifies interior occupants to hide.
    // movement.heading is a tile-space unit heading; stationary is (0,0).
    present(citizen, citizen.position);
  }
  return result.events;
}
function present(_citizen: Citizen, _position: Position): void { /* Phase 3B renderer */ }
const selected = simulation.getCitizen('npc-1'); // undefined after departure/removal
const population = simulation.getPopulationCount();
const occupancy = simulation.getBuildingOccupancy(selected?.homeBuildingId ?? 'home-villa');
const saved = serializeWorld(simulation.getState());
const restored = new Simulation(deserializeWorld(saved));
void [frame, population, occupancy, restored];
```

In the current app, continue using Pixi's existing ticker → hook.advance path. Do not call frame above as a second driver. If interpolating with result.alpha, retain the states on either side of the latest fixed tick; if advance executes multiple ticks, use the authoritative position or obtain the last pair. Skip interpolation for editor relocations and interior transitions. Renderer adapters must not mutate snapshots.

Select by stable ID with getCitizen. The engine indexes citizen and building occupancy queries once per changed snapshot. Read position/activity/home/work/schedule/movement from the same world. Clear selection when citizen.removed is returned. Population count is citizens.length; the existing home HUD still counts buildings and must not be relabeled without Phase 3B work. Activity changes and arrivals are typed events; citizen.moved carries positions and headings. clock.ticked provides day/minute. Events are immutable transient outputs.

Capture getCitySnapshot before an edit and restore through restoreCity for undo/redo. Managed snapshots include resident identities; history keeps clock/RNG/high-water marks moving forward. Save with existing saveCity/loadCitySave wrappers to retain frontend construction metadata and NPC state. In-flight routes, queued route requests, RNG, schedules, clock remainder and population cursor survive serialization. Queued commands remain runner-only; drain them or retain a separate journal before saving.

Daily schedules select the entry at the resulting minute. Seeded offsets vary departure/preparation/sleep times; work starts travelling around 07:00, leisure around 17:00, home around 19:00, sleep around 23:00. Missing jobs/leisure fall back home. Disconnected roads wait idle without repeated BFS each frame. Custom citizen.set-schedule switches scheduleMode to custom. Managed citizen.relocate is a debug/editor command restricted to roads or that citizen's referenced buildings.

Limits: 16 route requests per tick (cache hits consume the same slot), 4096 road nodes per BFS, 256 cache entries, 10000 citizens and managed minutesPerTick at most 1440. Default population cap is 1000. Long jumps select the final routine rather than replay every intermediate activity. Ordinary travel is progressive; demolition/reassignment and moving an occupied building can recover interior positions immediately as explicit editor operations. Road deletion underfoot leaves a traveller stationary until a legal access point is restored.

NPC progression does not increment city revision or change Phase 2 fingerprints. AI preview remains immutable; approval publishes one atomic batch including population reconciliation. Existing 4096-map-tile, one-megabyte API body and provider-context safeguards remain. Large saved routes can exceed the body limit; callers receive REQUEST_TOO_LARGE instead of paid provider work. NPC logic makes no Gemini calls.
