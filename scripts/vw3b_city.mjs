// "Coral Bay": the Visual World 3.0B showcase city with every building type, a widened plaza, residential,
// commercial and leisure districts, and open land left for building. `node scripts/vw3b_city.mjs` validates it
// against the real simulation placement rules.
export function coralBay() {
  const roads = new Map();
  const add = (x, y) => roads.set(`${x},${y}`, { x, y });
  for (let x = 6; x <= 46; x += 1) { add(x, 20); add(x, 30); }
  for (let y = 10; y <= 40; y += 1) { add(14, y); add(26, y); add(38, y); }
  for (let x = 6; x <= 13; x += 1) add(x, 13);
  for (let y = 19; y <= 21; y += 1) for (let x = 25; x <= 27; x += 1) add(x, y); // plaza
  let n = 0;
  const b = (kind, x, y, name) => ({ id: `cb-${kind}-${++n}`, kind, x, y, name, createdAt: 0 });
  const buildings = [
    // North-west leisure: pool and clubhouse on a lane, villas facing the avenue.
    b('pool', 6, 14, 'Coral Lido'), b('clubhouse', 9, 14, 'Coral Club'),
    b('villa', 6, 18, 'Shell Villa'), b('villa', 8, 18, 'Reef Villa'), b('villa', 10, 18, 'Cove Villa'), b('villa', 12, 18, 'Dune Villa'),
    // West residential block.
    b('villa', 6, 21, 'Palm Villa'), b('villa', 8, 21, 'Pine Villa'), b('villa', 10, 21, 'Olive Villa'), b('villa', 12, 21, 'Fig Villa'),
    b('park', 6, 23, 'Little Coral Park'), b('duplex', 11, 23, 'Tern Duplex'), b('duplex', 11, 26, 'Gull Duplex'),
    b('villa', 6, 28, 'Lagoon Villa'), b('villa', 8, 28, 'Harbour Villa'), b('villa', 10, 28, 'Breeze Villa'), b('villa', 12, 28, 'Tide Villa'),
    // Commercial centre around the plaza.
    b('mall', 15, 21, 'Harbour Mall'), b('office', 21, 21, 'Tide House'),
    b('apartment', 15, 16, 'Seabreeze Residences'), b('apartment', 19, 16, 'Marina Court'), b('office', 22, 11, 'Nova House'),
    b('townhouse', 15, 27, 'Bakery Row'), b('townhouse', 17, 27, 'Surf Row'), b('townhouse', 19, 27, 'Book Row'), b('townhouse', 21, 27, 'Cafe Row'), b('townhouse', 23, 27, 'Flower Row'),
    // East of the plaza.
    b('park', 27, 22, 'Coral Park'), b('townhouse', 31, 21, 'Harbour Row'), b('townhouse', 33, 21, 'Saltmarsh Row'), b('townhouse', 35, 21, 'Tide Row'),
    b('apartment', 27, 15, 'Coral Residences'), b('duplex', 31, 18, 'Heron Duplex'), b('duplex', 34, 18, 'Egret Duplex'),
    b('villa', 27, 28, 'Sand Villa'), b('villa', 29, 28, 'Coral Villa'), b('villa', 31, 28, 'Pearl Villa'), b('villa', 33, 28, 'Kelp Villa'), b('villa', 35, 28, 'Wave Villa'),
    // South of the second avenue (sparser, with free lots).
    b('villa', 6, 31, 'South Villa'), b('villa', 9, 31, 'Garden Villa'), b('villa', 15, 31, 'Bay Villa'), b('villa', 18, 31, 'Sun Villa'),
    b('duplex', 27, 31, 'Pelican Duplex'), b('villa', 31, 31, 'Marlin Villa'), b('clubhouse', 34, 31, 'Bay Club'), b('pool', 22, 31, 'Bay Lido'),
  ];
  return { size: 64, funds: 30_000, roads: [...roads.values()], buildings };
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { createWorld, validateBuildingPlacement, BUILDING_CATALOG } = await import('@tiny-city/simulation');
  const city = coralBay();
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
  console.log(`${city.buildings.length} buildings, ${city.roads.length} roads, ${bad} invalid`);
}
