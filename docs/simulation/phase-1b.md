# Phase 1B — Interactive city builder

Phase 1B connects the Architect Mode tools to the authoritative Phase 1A simulation. The browser editor displays a compatibility projection of `WorldState`; every build, move, road edit, and demolition is submitted as a simulation command and can be undone, redone, and saved.

## Builder features

- Paint connected road tiles and remove roads with the bulldozer.
- Place villas, duplexes, townhouses, apartments, parks, clubhouses, pools, malls, and offices from the build catalog.
- Preview a proposed footprint and show whether the lot is valid before placing it.
- Move a building by selecting the Move tool, choosing the source building, then choosing a destination tile. Moves preserve the building ID and cost no funds.
- Inspect footprint, capacity, map location, road requirement, construction state, and demolish a selected building.
- Keep continuous placement active so a player can build multiple lots without reselecting the tool.
- Save, undo, and redo city edits through the existing browser save and simulation snapshot flow.

## Catalog rules

| Building | Footprint | Capacity | Cost | Road access |
| --- | ---: | ---: | ---: | --- |
| Villa | 2 × 2 | 2 | $120 | Required |
| Duplex | 3 × 2 | 4 | $180 | Required |
| Townhouse | 2 × 3 | 4 | $160 | Required |
| Apartment | 4 × 4 | 24 | $480 | Required |
| Park | 4 × 4 | 20 | $80 | Optional |
| Clubhouse | 3 × 3 | 20 | $220 | Required |
| Pool | 3 × 4 | 30 | $180 | Required |
| Mall | 6 × 5 | 100 | $900 | Required |
| Office | 4 × 4 | 60 | $640 | Required |

The simulation catalog remains the source of truth for prices, footprints, capacities, and road-adjacency rules. Demolition and moving are free. Demolition does not refund construction costs and is rejected for buildings referenced by a citizen. Moves preserve identity and references, require a vacant buildable footprint, and enforce the destination's road rule.

## Phase boundary

This phase delivers Architect Mode construction and inspection. It does not add AI city planning, traffic, NPC movement, property economics, or Life Mode. Construction animation and building appearance are presentation metadata in the PixiJS renderer; they are not stored in `WorldState`.
