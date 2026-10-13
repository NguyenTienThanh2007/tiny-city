# Architectural Style Selector

Flow: Build → building tool (rail or catalog) → **collection** → **model** (or a varied mix) → live preview on
the map → click to build → the inspector names the model.

## UI (`src/ui/ArchitecturePicker.tsx`, inside the Build panel's tool card)

- **Collection chips** (`radiogroup "Architectural collection"`): a palette swatch, the name, and the count of
  available models for this building type. Only collections with models for the type are listed.
- **Collection description** and a **selected-model card**: a large baked thumbnail, the name, a description and
  feature tags. For a mix, the card says which collection and how the model is chosen.
- **Model grid** (`radiogroup "Building model"`): baked thumbnails and names, plus "Varied mix" when the
  collection has more than one model. Planned models are shown as disabled “Coming soon” cards.
- **District cohesion:** “Use <collection> for every building type” sets that collection (as a mix, or its single
  model) for every type it covers. It applies to future builds only and shows a notice. Existing buildings never
  change.
- When a building tool is active, the tool card and selector lead the panel; otherwise the onboarding guide does.
- **Cost, capacity and footprint** rows are unchanged; the selector header says “Cosmetic · same cost & capacity”.
- **Phone:** the selector lives in the Build sheet, and the model grid becomes a horizontal snap-scrolling strip
  with no page overflow (e2e checked).
- Choices are remembered per viewer (`localStorage`, with try/catch). They are never part of the city save.

## Exact preview and construction

The simulation assigns building IDs deterministically (`building-N`), so `predictBuildingId(world)`
(`src/game/architecture.ts`) gives the ghost the same ID and `resolveChoice(kind, choice, id)` the same design that
construction will record. The preview label names the model ("Villa · 2 × 2 · Ready to build · $120 · Glass
Pavilion Villa"), and the ghost is the baked sprite of that model, facing the road it will face.

Validity, road-access hints, collision and depth are the existing placement rules. Funds are charged only when
the simulation applies the build.

Construction goes through the single commit boundary (`commitCommands(commands, designFor)` in `App.tsx`), which
records each new building's design in the same history step. The default choice, **Classic mix**, records the
classic variant the building's ID has always produced, so default play looks exactly like 3.0C.

## Seeing the design later

The building inspector shows the model's thumbnail and an "Architecture" line ("Luxury Minimalist · Glass Pavilion
Villa"). The renderer reports `drawnModels`, `bakedBuildings` and `vectorBuildings` in `window.__tinyCityRenderer`
for tests and diagnostics.
