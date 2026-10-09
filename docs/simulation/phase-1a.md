# Phase 1A contract coordination

The simulation becomes the authority for builder changes. React/PixiJS submits typed commands and renders the resulting world; editor roads, funds, and building collections become compatibility projections rather than independent editable state.

## Contract changes

- World schema version 2 adds `budget`, `revision`, and `nextBuildingId`.
- `CityPlan` adds canonical `roads` and `blockedTiles`. Grid positions are integer tile coordinates; blocked tiles preserve the existing coast/buildable-area rule.
- Buildings may identify a catalog `type` (`villa`, `park`, or `clubhouse`). Authored legacy buildings without a catalog type retain their explicit footprints and roles.
- A centralized immutable catalog owns footprint, role, capacity, price, and road-adjacency rules. Prices remain villa $120, park $80, clubhouse $220, and road tile $8.
- New commands are `city.build`, `city.demolish`, and `city.edit-roads`. Immediate editor commands work while paused; queued commands execute FIFO at tick boundaries. Command batches are atomic.
- Typed events cover builds, demolition, road/network changes, spending, restoration, and rejection. Failed commands do not consume funds, IDs, revisions, or RNG.

## Rules and compatibility decisions

New villas and clubhouses need a road along any orthogonal footprint edge. Parks do not. Corner-only contact does not count. Road edits may create disconnected components or isolate an existing building; the graph and network events expose that state without adding traffic or NPC routing. Existing authored/migrated layouts are grandfathered for adjacency, but always validated for bounds and overlapping/blocked occupancy.

Demolition and road removal are free and do not refund construction costs, matching the existing builder. Demolition of a citizen-referenced building is rejected rather than inventing a relocation policy. Budget amounts are integer dollars; balance plus total spent must equal the opening balance.

Occupancy grids and road graphs are derived indexes. They are rebuilt after restoration and are not duplicated in saved state. World snapshots include clock remainders, RNG, budget, ID cursor, and revision. Deterministic serialization canonicalizes JSON object keys and preserves all collection order for exact restoration. Road graph queries independently sort their components and neighbors, regardless of road insertion order.

Legacy Phase 0 worlds migrate with the saved editor roads and current funds as their opening balance; past spending is not guessed. The original browser storage key and top-level map fields remain supported. New saves carry a schema-2 simulation snapshot as authority, with old editor timestamps retained only for construction presentation.

Undo/redo restores validated city snapshots (layout and budget) through the engine while retaining current simulation time, RNG, and pending commands. The building-ID cursor retains its high-water mark to avoid reusing IDs from an abandoned history branch. Raw layout replacement is restricted once this world is active; normal edits must use commands or validated history restoration.

## Phase boundary

No Gemini, NPC movement/pathfinding, traffic, graphics changes, or other phases are included. These contracts remain in `packages/simulation`; no duplicate shared/Python model is introduced. Future consumers should review this document before extending the command vocabulary, changing budget/refund policy, or exposing a transport API.
