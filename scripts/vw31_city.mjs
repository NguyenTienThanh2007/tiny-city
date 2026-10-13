// Visual World 3.1 showcase cities. `node scripts/vw31_city.mjs` validates both against the real simulation
// placement rules and the architecture registry.
//   coralBay31(): the Coral Bay layout (scripts/vw3b_city.mjs) with architectural designs chosen per district —
//     a Luxury Minimalist residential quarter, an Urban Premium downtown, Tropical Contemporary leisure and a
//     Family Garden edge. The same layout without designs is the matched "before" (3.0C look).
//   gallery(): every new model, row by row, for collection close-ups.
import { coralBay } from './vw3b_city.mjs';

const d = (model) => ({ collection: { lm: 'luxury-minimalist', mc: 'modern-coastal', tc: 'tropical-contemporary', up: 'urban-premium', fg: 'family-garden' }[model.split('.')[0]], model });

/** Coral Bay with a district-by-district architectural plan (buildings keep their IDs, kinds, lots and names). */
export function coralBay31() {
  const city = coralBay();
  const lmVillas = ['lm.villa.glass-pavilion', 'lm.villa.sculptural-concrete', 'lm.villa.minimal-courtyard', 'lm.villa.sky-terrace', 'lm.villa.linear-modern', 'lm.villa.tropical-minimalist'];
  const pick = (list, i) => list[i % list.length];
  let villa = 0, duplex = 0, town = 0, apt = 0;
  const designs = {
    // Downtown (Urban Premium): the commercial centre around the plaza.
    'Harbour Mall': 'up.mall.glass', 'Tide House': 'up.office.premium-tower', 'Nova House': 'up.office.glass', 'Coral Park': 'up.park.urban',
    // Leisure (Tropical Contemporary) to the north-west, Luxury Minimalist club and lido in the south.
    'Coral Lido': 'tc.pool.resort', 'Coral Club': 'tc.clubhouse.resort', 'Little Coral Park': 'tc.park.tropical-garden',
    'Bay Club': 'lm.clubhouse.glass-pavilion', 'Bay Lido': 'lm.pool.geometric',
  };
  for (const building of city.buildings) {
    const fixed = designs[building.name];
    if (fixed) { building.design = d(fixed); continue; }
    if (building.kind === 'villa') {
      // West and north rows: Luxury Minimalist; south of the second avenue: a coastal and garden edge.
      building.design = d(building.y >= 31 ? pick(['mc.villa.shoreline', 'fg.villa.garden-porch', 'tc.villa.lanai'], villa) : pick(lmVillas, villa));
      villa += 1;
    } else if (building.kind === 'duplex') building.design = d(pick(['lm.duplex.twin-glass', 'lm.duplex.asymmetric-concrete', 'lm.duplex.courtyard', 'lm.duplex.urban-terrace'], duplex++));
    else if (building.kind === 'townhouse') building.design = d(pick(['lm.townhouse.vertical-minimalist', 'lm.townhouse.urban-glass', 'lm.townhouse.rooftop-terrace', 'lm.townhouse.warm-timber'], town++));
    else if (building.kind === 'apartment') building.design = d(pick(['lm.apartment.premium-glass', 'lm.apartment.green-terrace', 'lm.apartment.residential-tower'], apt++));
  }
  return city;
}

/** Architecture gallery: one street per row of models, everything on the north side of its street. */
export function gallery() {
  const roads = new Map();
  const add = (x, y) => roads.set(`${x},${y}`, { x, y });
  for (const y of [12, 21, 31, 43, 55]) for (let x = 3; x <= 56; x += 1) add(x, y);
  let n = 0;
  const b = (kind, x, y, model, name) => ({ id: `gal-${++n}`, kind, x, y, name: name ?? model.split('.').at(-1), createdAt: 0, design: d(model) });
  const buildings = [
    // Row 1: villas (2×2) — six Luxury Minimalist, then the other collections.
    ...['glass-pavilion', 'sculptural-concrete', 'minimal-courtyard', 'sky-terrace', 'linear-modern', 'tropical-minimalist'].map((slug, i) => b('villa', 4 + i * 3, 10, `lm.villa.${slug}`)),
    b('villa', 23, 10, 'mc.villa.shoreline'), b('villa', 26, 10, 'tc.villa.lanai'), b('villa', 29, 10, 'fg.villa.garden-porch'),
    // Row 2: duplexes (3×2) and townhouses (2×3).
    ...['twin-glass', 'asymmetric-concrete', 'courtyard', 'urban-terrace'].map((slug, i) => b('duplex', 4 + i * 4, 19, `lm.duplex.${slug}`)),
    ...['vertical-minimalist', 'urban-glass', 'rooftop-terrace', 'warm-timber'].map((slug, i) => b('townhouse', 21 + i * 3, 18, `lm.townhouse.${slug}`)),
    // Row 3: apartments (4×4).
    ...['premium-glass', 'green-terrace', 'residential-tower', 'contemporary-courtyard'].map((slug, i) => b('apartment', 4 + i * 5, 27, `lm.apartment.${slug}`)),
    // Row 4: offices (4×4) and malls (6×5).
    b('office', 4, 39, 'lm.office.architectural-concrete'), b('office', 9, 39, 'tc.office.rooftop-garden'), b('office', 14, 39, 'up.office.glass'), b('office', 19, 39, 'up.office.premium-tower'),
    b('mall', 24, 38, 'lm.mall.boutique-frontage'), b('mall', 31, 38, 'tc.mall.shopping-pavilion'), b('mall', 38, 38, 'up.mall.glass'),
    // Row 5: clubhouses (3×3), pools (3×4) and parks (4×4).
    b('clubhouse', 4, 52, 'lm.clubhouse.glass-pavilion'), b('clubhouse', 8, 52, 'mc.clubhouse.leisure'), b('clubhouse', 12, 52, 'tc.clubhouse.resort'),
    b('pool', 16, 51, 'lm.pool.geometric'), b('pool', 20, 51, 'tc.pool.resort'), b('pool', 24, 51, 'fg.pool.community'),
    b('park', 28, 51, 'lm.park.community-plaza'), b('park', 33, 51, 'tc.park.tropical-garden'), b('park', 38, 51, 'up.park.urban'),
  ];
  return { size: 64, funds: 50_000, roads: [...roads.values()], buildings };
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { createWorld, validateBuildingPlacement, BUILDING_CATALOG } = await import('@tiny-city/simulation');
  const { isSelectableDesign } = await import('@tiny-city/ai-architect');
  for (const [label, city] of [['coralBay31', coralBay31()], ['gallery', gallery()]]) {
    const blockedTiles = [];
    for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) if (!(x + y < 64 * 2 - 8)) blockedTiles.push({ x, y });
    const placed = [];
    let bad = 0;
    for (const b of city.buildings) {
      const world = createWorld({ id: 'v', seed: 's', plan: { id: 'p', name: 'p', width: 64, height: 64, roads: city.roads, blockedTiles, buildings: placed }, startingFunds: 1_000_000 });
      const result = validateBuildingPlacement(world, b.kind, { x: b.x, y: b.y });
      if (!result.valid) { bad += 1; console.log('INVALID', label, b.name, b.kind, b.x, b.y, result.reason); continue; }
      if (b.design && !isSelectableDesign(b.kind, b.design)) { bad += 1; console.log('BAD DESIGN', label, b.name, JSON.stringify(b.design)); }
      placed.push({ id: b.id, name: b.name, kind: BUILDING_CATALOG[b.kind].kind, type: b.kind, position: { x: b.x, y: b.y }, footprint: { ...BUILDING_CATALOG[b.kind].footprint }, capacity: BUILDING_CATALOG[b.kind].capacity });
    }
    console.log(`${label}: ${city.buildings.length} buildings, ${city.buildings.filter((b) => b.design).length} designed, ${bad} invalid`);
  }
}
