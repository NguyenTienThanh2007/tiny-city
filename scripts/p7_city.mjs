// Phase 7 showcase: "Coral Bay Nights" — Coral Bay 3.1 (scripts/vw31_city.mjs) plus an entertainment district east
// of the third avenue: cafés, two shopping streets, a night market, a cinema, a music club, a concert stage, a
// performance plaza, an amusement park, and homes for the district's own neighbourhood behind it.
// `node scripts/p7_city.mjs` validates every lot against the real simulation placement rules.
import { pathToFileURL } from 'node:url';
import { coralBay31 } from './vw31_city.mjs';

export function coralBayNights() {
  const city = coralBay31();
  const roads = new Map(city.roads.map((tile) => [`${tile.x},${tile.y}`, tile]));
  const add = (x, y) => roads.set(`${x},${y}`, { x, y });
  for (let x = 47; x <= 60; x += 1) { add(x, 20); add(x, 30); }
  for (let y = 12; y <= 40; y += 1) add(52, y);
  let n = 0;
  const b = (kind, x, y, name) => ({ id: `cn-${kind}-${++n}`, kind, x, y, name, createdAt: 0 });
  const district = [
    // North of the high street: the cinema, the music club and the night market; across the avenue a café and shops.
    b('cinema', 40, 17, 'Bayside Cinema'), b('nightclub', 44, 18, 'Blue Note Club'), b('market', 47, 17, 'Lantern Night Market'),
    b('cafe', 53, 18, 'Dune Café'), b('shops', 56, 18, 'Seaglass Arcade'),
    // South of the high street: cafés either side of a shopping street, and the performance plaza on the corner.
    b('cafe', 40, 21, 'Corner Café'), b('shops', 43, 21, 'Harbour Arcade'), b('cafe', 48, 21, 'Garden Bistro'), b('plaza', 53, 21, 'Fountain Plaza'),
    // The second street: the concert stage and the amusement park.
    b('stage', 40, 26, 'Bayside Stage'), b('amusement', 53, 25, 'Seaside Fun Park'),
    b('cafe', 40, 31, 'Pier Café'),
    // Homes for the district's own neighbourhood stand behind it (north), so they never hide the venues on screen.
    b('apartment', 39, 13, 'Lantern Residences'), b('apartment', 48, 12, 'Arcade Lofts'), b('apartment', 53, 12, 'Seaside Residences'),
  ];
  return { ...city, funds: 40_000, roads: [...roads.values()], buildings: [...city.buildings, ...district] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { createWorld, validateBuildingPlacement, BUILDING_CATALOG } = await import('@tiny-city/simulation');
  const city = coralBayNights();
  const blockedTiles = [];
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) if (!(x + y < 64 * 2 - 8)) blockedTiles.push({ x, y });
  const placed = [];
  let bad = 0;
  for (const b of city.buildings) {
    const world = createWorld({ id: 'v', seed: 's', plan: { id: 'p', name: 'p', width: 64, height: 64, roads: city.roads, blockedTiles, buildings: placed }, startingFunds: 1_000_000 });
    const result = validateBuildingPlacement(world, b.kind, { x: b.x, y: b.y });
    if (!result.valid) { bad += 1; console.log('INVALID', b.name, b.kind, b.x, b.y, result.reason); continue; }
    placed.push({ id: b.id, name: b.name, kind: BUILDING_CATALOG[b.kind].kind, type: b.kind, position: { x: b.x, y: b.y }, footprint: { ...BUILDING_CATALOG[b.kind].footprint }, capacity: BUILDING_CATALOG[b.kind].capacity });
  }
  console.log(`coralBayNights: ${city.buildings.length} buildings, ${city.roads.length} road tiles, ${bad} invalid`);
}
