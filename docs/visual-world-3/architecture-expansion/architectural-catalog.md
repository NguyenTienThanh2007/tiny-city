# Architectural Catalog

The source of truth is `packages/ai-architect/src/architecture.ts`. Model IDs are stable (`<collection>.<type>.<slug>`)
and must never be renamed or reused. Every **available** model is baked for both facings (parks: one), has a
catalog thumbnail, and is checked against the manifest by `src/game/architecture.test.ts`. **Planned** models are
listed in the selector with “Coming soon” and cannot be chosen or requested from the AI Architect.

Counts: 63 available (26 classic, 37 new) and 3 planned.

## Luxury Minimalist (23 new, all available)

| Type | Model | Signature |
|---|---|---|
| Villa | Glass Pavilion Villa | Floating single roof plane, walls of glass, stone core, walnut screen, reflecting pool crossed by stepping stones |
| Villa | Sculptural Concrete Villa | Upper concrete box cantilevered far over the driveway on one slim column, ribbon and slot windows, lit soffit |
| Villa | Minimal Courtyard Villa | L of low volumes around a private court with a specimen tree and basin, walnut slat screens, framed portal gate |
| Villa | Sky Terrace Villa | Stepped volumes: walnut upper floor with roof garden, sky terrace with glass balustrade, slim pergola and lounge |
| Villa | Linear Modern Villa | Long low bar, darker sliding upper layer, stone feature wall running into the garden, entry canopy, lap pool, solar |
| Villa | Tropical Minimalist Villa | Deep shaded balcony with walnut sun slats and soffit, wide roof slab, plunge-pool courtyard, palms and bananas |
| Duplex | Twin Glass Duplex | Mirrored double-height glass fronts under one slab, stone party fin, skylights |
| Duplex | Asymmetric Concrete Duplex | Tall concrete home beside a low one carrying a cantilevered walnut box |
| Duplex | Courtyard Duplex | Twin homes opening through glass onto walled garden courts with timber gates and roof garden |
| Duplex | Urban Terrace Duplex | Charcoal frame, timber fins, planted roof terraces with pergolas |
| Townhouse | Vertical Minimalist Townhouse | Alternating heights, deep two-storey projecting frames (charcoal or bronze), stone fins, lit recessed doors |
| Townhouse | Urban Glass Townhouse | Full glass fronts in slim charcoal frames, bronze canopies |
| Townhouse | Rooftop Terrace Townhouse | Set-back walnut top storey, roof gardens, glass balustrades, pergolas |
| Townhouse | Warm Timber Townhouse | Walnut cladding, timber screens over windows, planted ledges |
| Apartment | Premium Glass Residence | Seven glass storeys with ivory wraparound balconies, bronze lobby canopy |
| Apartment | Green Terrace Apartments | Floors stepping back south and east, planted terraces, timber soffits, roof pergola |
| Apartment | Minimalist Residential Tower | Stone base, ivory tower with loggias, bronze-finned crown |
| Apartment | Contemporary Courtyard Apartments | U-shaped block around a landscaped court with a reflecting pool, walnut screens |
| Office | Architectural Concrete Office | Deep concrete pier-and-band frame over recessed glass, roof garden, garden court |
| Mall | Boutique Retail Frontage | Stone-pier arcade of bronze-framed boutiques, glazed atrium with bronze fins, roof garden |
| Clubhouse | Minimalist Glass Pavilion | Glass box under a floating plate, wrapping reflecting pools, lounge terrace |
| Pool | Luxury Geometric Pool | Interlocking rectangular pools, timber cabanas, sunken lounge, stone pool house |
| Park | Premium Community Plaza | Sculpted lawn terraces, water table, timber pergola, column-tree avenue |

## Other collections (14 new available, 3 planned)

| Collection | Type | Model | Status |
|---|---|---|---|
| Modern Coastal | Villa | Shoreline Gable Villa: steep standing-seam gable, glazed gable end, board-and-batten, deep porch, dune garden | Available |
| Modern Coastal | Clubhouse | Contemporary Leisure Clubhouse: gabled boathouse hall, wraparound deck, flagpole | Available |
| Modern Coastal | Duplex | Dune Cottage Duplex | Planned |
| Tropical Contemporary | Villa | Lanai Pavilion Villa: broad hipped shade roof over an open lanai, breeze-block screen | Available |
| Tropical Contemporary | Mall | Contemporary Shopping Pavilion: hipped timber-roofed wings around a palm courtyard with café terraces | Available |
| Tropical Contemporary | Office | Rooftop Garden Office: terraced planted floors, timber louvres, roof garden | Available |
| Tropical Contemporary | Clubhouse | Tropical Resort Clubhouse: tall two-tier pavilion roof over a round bar, pool deck | Available |
| Tropical Contemporary | Pool | Modern Resort Pool: lagoon basins, swim-up island, daybeds | Available |
| Tropical Contemporary | Park | Tropical Garden Park: boardwalk loop, pond pavilion on stilts, dense planting | Available |
| Urban Premium | Office | Modern Glass Office: curved glass corner, silver floor lines, glowing lobby | Available |
| Urban Premium | Office | Premium Commercial Tower: three setbacks with bronze fins, lit lantern crown and spire | Available |
| Urban Premium | Mall | Premium Glass Mall: glass box, cantilevered canopy, media wall | Available |
| Urban Premium | Park | Modern Urban Park: tree bosque, sunken amphitheatre, jet fountain plaza | Available |
| Urban Premium | Townhouse | Skyline Townhouse | Planned |
| Family Garden Homes | Villa | Garden Porch Home: gabled home, dormer, wraparound porch, vegetable beds, swing | Available |
| Family Garden Homes | Pool | Landscaped Community Pool: splash pad, playground, picnic lawn | Available |
| Family Garden Homes | Duplex | Twin Garden Cottages | Planned |

Coverage gaps, stated honestly: Modern Coastal, Tropical Contemporary, Urban Premium and Family Garden Homes do not
cover every building type. The selector only lists collections that have models for the chosen type. The AI
Architect refuses, rather than substitutes, a style with no models for a type (“Family Garden Homes has no
townhouse models yet.”).

## Classic Coastal (26, the 3.0B bakes)

Villas: Portico Pool, Slate Patio, Teal Garden, Cypress Pool. Duplexes: Olive, Teal and Terracotta Twin Gables.
Townhouses: Harbour, Market and Garden Row. Apartments: Seabreeze, Marina, Coral. Parks: Fountain, Pond, Pavilion.
Clubhouses: Garden, Lagoon, Cove. Pools: Lido, Splash. Malls: Harbour, Lagoon. Offices: Tide, Nova, Helix. These are the
exact 3.0B art; “Classic mix” (the default) gives each new building the classic variant its ID always produced.
