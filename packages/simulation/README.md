# @tiny-city/simulation

Headless TypeScript engine with no runtime dependencies. Exposes readonly schema-2 contracts, a deterministic clock, seeded randomness, authoritative city build/move/demolish/road commands and budgets, occupancy and road topology, typed events, and deterministic serialization/Phase 0 migration.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

```ts
import { Simulation } from '@tiny-city/simulation';
import { createDemoWorldFixture } from '@tiny-city/simulation/fixtures';

const simulation = new Simulation(createDemoWorldFixture({ seed: 'tiny-city' }));
const result = simulation.advance(100);
// result.state, result.events, result.steps, result.alpha
```

Requires Node.js 22.12+ for development tooling. Output is ESM targeting ES2022 and includes declarations. Build before consuming the package.

See [public contracts](../../docs/simulation/contracts.md), [Phase 1A coordination](../../docs/simulation/phase-1a.md), [Phase 1B builder](../../docs/simulation/phase-1b.md), and [frontend integration](../../docs/simulation/integration.md).

Managed NPCs are opt-in through `createWorld({…, population: {maxCitizens: 1000}})` or `simulation.enablePopulation()`. Seeded residents fill housing, take available jobs, follow varied schedules and progressively navigate legal roads. City edits, history and serialization reconcile their references. Legacy worlds remain compatible. See the [Phase 3A contract](../../docs/npc/phase-3a-contracts.md) and [integration examples](../../docs/npc/phase-3a-integration.md), including `createLivingWorldFixture()`. Run the root `npm run bench:npc` for measured performance. No Gemini calls, NPC visuals or storage backend are included in this package.
