# Compatibility

## Where the identity lives

`Building.design?: { collection, model }` (`src/types.ts`) is editor metadata, like `createdAt`. That follows the
established rule that rendering styles belong to the consumer (`CityPlan` docs, `CLAUDE.md`).

- `collection` is the architectural style ID (e.g. `luxury-minimalist`).
- `model` is the architectural model ID (e.g. `lm.villa.glass-pavilion`).
- The facing variant (S or E) is derived from the roads at draw time, never stored.
- The simulation, its schema-2 serialization and all rules are unchanged. Designs never affect cost, capacity,
  footprint, placement, NPCs or Life Mode.

## Persistence paths

| Path | Behaviour | Tested by |
|---|---|---|
| Construction (manual and AI) | `commitCommands` records the design of each new building in the same history step | e2e selector + AI specs |
| Later edits (move, roads, demolish others) | `projectCity` carries designs by building ID | `architecture.test.ts` |
| Undo / redo | History entries hold the editor city with designs | e2e selector spec |
| Local save / reload | Saved in the v3 envelope's `buildings[]`; sanitized on load | unit + e2e |
| Cloud save | The API stores the envelope verbatim; loads go through the same decoder | API `test_cloud_saves_keep_architectural_designs_verbatim` + unit envelope round trip |
| Renderer recreation, day/night, zoom | Selection depends only on ID, kind, design and roads | e2e long-session spec |
| Asset bundle rebuilt without a model | Falls back to the same collection, then classic; the stored ID is kept | unit |

## Older cities

- Saves without designs load unchanged and render the classic variant from the building ID, exactly as in 3.0C.
- The classic atlas pages are byte-identical, and no new model is ever picked for a building without a design.
- Nothing is restyled silently. A design is only recorded when a building is built, by the player's choice or an
  approved AI plan. The default "Classic mix" records the classic look the ID produces.
- A malformed `design` (wrong types, extra keys, unsafe IDs) is dropped on load; the building and city still load.
  Well-formed but unknown IDs (from a newer version) are kept and render through the fallbacks.

## Multiplayer readiness

Identity is a pair of stable strings keyed to a deterministic building ID. Clients with the same registry render
identically with no random state. The registry is exported to the API in `catalog.json`.

## Security

- No new endpoints and no auth changes.
- Guest sessions, cloud-save access rules and the session check without a 401 (PR #18) are untouched.
- Design strings are bounded and pattern-checked in TypeScript and Python.
