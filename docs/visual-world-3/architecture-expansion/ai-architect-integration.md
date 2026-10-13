# AI Architect Integration

Pipeline: natural language → intent (Gemini, or the offline rules interpreter) → **design validation** →
deterministic placement → proposal with per-building designs → preview of the exact models → user approval →
one atomic simulation batch → designs recorded with the new buildings → saved, rendered.

## Contract

- `BuildRequest.design?: { collection: string | null; model: string | null } | null`. Each part may be a registry
  ID or a display name or alias ("Luxury Minimalist", "Glass Pavilion Villa", "tối giản sang trọng"). Older intents
  without designs decode unchanged; `decodeIntent` normalizes to `design: null` so digests never depend on wire
  formatting.
- `PlanProposal.placements[].design: BuildingDesign | null`. It is part of the plan digest, so `PlanReview`'s
  authoritative re-planning must reproduce exactly the same designs before approval.
- API (`architect_models.py`): strict `BuildDesign` and `PlacementDesign`, with unknown keys and over-long values
  rejected. The Gemini system instruction appends the generated architecture catalog (IDs and names from
  `catalog.json`, never a Python copy). It tells the model to copy only styles the user named and never to replace
  an unknown model.

## Validation (planner `resolveDesign`)

| Request | Result |
|---|---|
| A collection | Builds cycle through that collection's models for this type (5 villas → 5 different models) |
| A model (ID or name) | Every build of that request is exactly that model |
| Unknown style or model | Refused: `UNSUPPORTED_DESIGN` “… is not in the catalog.” |
| Model of another type | Refused: “Twin Glass Duplex is a duplex model, not a villa.” |
| Planned model | Refused: “… is planned but not available yet.” |
| Collection without models for the type | Refused: “Family Garden Homes has no townhouse models yet.” |
| Model and collection that disagree | Refused: “… belongs to Luxury Minimalist, not Modern Coastal.” |

A refusal never substitutes another design. Without partial plans the whole plan is rejected. With partial plans
allowed, the supported builds proceed and the refusal is listed. Costs, footprints and capacity are the
catalog's, whatever the design (tested).

## Offline interpreter (`interpret.ts`, explicit `local` mode)

It recognizes model and collection names in English and Vietnamese. A model applies to builds of its type in the
same clause, and a collection applies to all builds in the clause. Counts are read before the style phrase
("three Glass Pavilion Villas"). A named model without its building word becomes a build of that model's type.

A generic “modern” / “hiện đại” with no named style uses Luxury Minimalist, and the summary says so. A style
with no buildings named asks how many of which buildings.

Spec examples (all tested):

| Request | Interpretation |
|---|---|
| “Xây 5 biệt thự Luxury Minimalist gần công viên.” | 5 villas, Luxury Minimalist, near the park |
| “Build three Glass Pavilion Villas along the main road” | 3 × Glass Pavilion Villa, near the road |
| “Tạo một khu phố hiện đại gồm 4 biệt thự và 6 nhà phố” | 4 villas + 6 townhouses, Luxury Minimalist (stated) |
| “Create a premium Modern Coastal neighborhood” | Asks which buildings and how many (no invented buildings) |
| “Build two Sculptural Concrete Villas near the pool” | 2 × Sculptural Concrete Villa |

## Frontend

- The AI preview overlay draws every planned building as a translucent sprite of its exact model.
- The plan panel lists "Plan architecture" (thumbnail, count × model, collection), and each proposed location names its model.
- On approval the designs are passed to the commit boundary by predicted building ID (falling back to build
  order); undo, save and cloud save keep them.
- Destructive-action confirmation, mock and offline modes, and the `{requestId, error}` contract are unchanged.
- Normal manual building never needs the API.
