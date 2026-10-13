// Visual World 3.1 architecture collections beyond Luxury Minimalist. Each has its own geometry and motifs:
//   Modern Coastal (mc): white board-and-batten, steep standing-seam gables, deep porches, dune planting.
//   Tropical Contemporary (tc): broad hipped shade roofs, timber louvres, breeze-block screens, courtyards, palms.
//   Urban Premium (up): curtain walls, dark frames, vertical fins, illuminated crowns, paved plazas.
//   Family Garden (fg): gabled family homes with porches, vegetable beds, play lawns and picnic gardens.
// Built facing south (+Z); malls and pools are parametric in W × D like the classic bakes.
import * as THREE from 'three';
import { box, plate, rng, mat, path, roof, cylinder, sphere, palm, fanPalm, bananaPlant, broadleaf, shrub, flowerbed, hedge, woodMat, wallMat, stoneMat, leafMat, pick, umbrella } from '../lib/kit.js';
import { signOn, car, CAR_COLORS, picnicTable, playground, picketFence } from '../lib/props.js';
import { LUX, metal, bronze, plasterMat, concrete, stone, walnut, slab, roofDeck, glassWall, framedWindow, slats, slatScreen, fins, stoneWall,
  glassRail, slimPergola, grass, shrubBall, multiStemTree, columnTree, planterBox, steppingStones, pool, lounge, loungers, bollardLight, lightLine,
  boundaryWall, pivotDoor, skylight, solarPanels, roofGarden, deck, terrace, diningSet, driveway } from '../lib/modern.js';

const LAWN = 0x8db276;
const COAST = { white: 0xf7f7f2, batten: 0xeef0ec, seam: 0x4d6470, deck: 0xc9b28c, trim: 0xffffff, blue: 0x9fb7c4 };
const TROPIC = { wall: 0xefe6d6, timber: 0x8c6a46, roof: 0x5b4a3a, block: 0xe2d6bf, leaf: 0x4f7c52 };
const URBAN = { glass: 0x7f9bb0, frame: 0x2b3338, gold: 0xc9a46a, stone: 0xdfe0dc };
const FAMILY = { wall: 0xf6ead6, timber: 0xa8754c, roof: 0xc96f4f, green: 0x7fa36b, trim: 0xffffff };

/** Board-and-batten cladding: a wall block plus fine vertical battens on its visible faces. */
function battenBlock(parent, x0, z0, x1, z1, h, color = COAST.white) {
  box(parent, x0, 0, z0, x1 - x0, h, z1 - z0, wallMat(color));
  const bm = mat(COAST.batten, { rough: 0.7 });
  for (let x = x0 + 0.04; x < x1 - 0.02; x += 0.06) box(parent, x, 0.02, z1, 0.01, h - 0.04, 0.008, bm);
  for (let z = z0 + 0.04; z < z1 - 0.02; z += 0.06) box(parent, x1, 0.02, z, 0.008, h - 0.04, 0.01, bm);
}
/** Breeze-block screen wall: a grid of square blocks with open cells. */
function breezeBlock(parent, x, z, w, h, axis, color = TROPIC.block) {
  const m = mat(color, { rough: 0.9, tex: 'concrete' });
  const cell = 0.06;
  for (let r = 0; r < Math.floor(h / cell); r += 1) for (let c = 0; c < Math.floor(w / cell); c += 1) {
    const ox = c * cell, oy = r * cell;
    if (axis === 'x') { box(parent, x + ox, oy, z, cell, 0.012, 0.04, m); box(parent, x + ox, oy, z, 0.012, cell, 0.04, m); }
    else { box(parent, x, oy, z + ox, 0.04, 0.012, cell, m); box(parent, x, oy, z + ox, 0.04, cell, 0.012, m); }
  }
  if (axis === 'x') box(parent, x, Math.floor(h / cell) * cell, z, Math.floor(w / cell) * cell, 0.02, 0.045, m);
  else box(parent, x, Math.floor(h / cell) * cell, z, 0.045, 0.02, Math.floor(w / cell) * cell, m);
}
/** Plain sash-style window with a white frame for the coastal and family homes. */
function cottageWindow(parent, side, plane, u, v, w, h, frame = COAST.trim, lit = null) {
  return framedWindow(parent, side, plane, u, v, w, h, { surround: frame, depth: 0.03, material: mat(frame, { rough: 0.6 }), lit });
}

// ─── Modern Coastal ─────────────────────────────────────────────────────────────────────────────────────────

// SHORELINE GABLE VILLA: white board-and-batten under a steep standing-seam gable, deep porch and deck.
function shorelineVilla(group, random) {
  plate(group, 2, 2, 0x9cbf82);
  const x0 = 0.3, x1 = 1.5, z0 = 0.3, z1 = 1.1, H = 0.5;
  battenBlock(group, x0, z0, x1, z1, H);
  // Steep metal gable with the ridge across (gable end faces the street), plus a lower wing.
  roof(group, { x0: x0 - 0.06, z0: z0 - 0.06, x1: x1 + 0.06, z1: z1 + 0.06, y: H, rise: 0.55, color: COAST.seam, ridge: 'z', gableColor: COAST.white, tex: 'seam' });
  glassWall(group, 'south', z1, 0.62, 0.02, 0.56, 0.42, { bay: 0.14, frame: COAST.trim, lit: true });
  const gableGlass = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.66, H + 0.02, z1 + 0.066), new THREE.Vector3(1.14, H + 0.02, z1 + 0.066), new THREE.Vector3(0.9, H + 0.36, z1 + 0.066)]), new THREE.MeshPhysicalMaterial({ color: 0xa9cdd6, roughness: 0.05, clearcoat: 1, side: THREE.DoubleSide }));
  gableGlass.geometry.computeVertexNormals(); gableGlass.userData.window = true; gableGlass.userData.lit = true; group.add(gableGlass);
  cottageWindow(group, 'east', x1 + 0.008, 0.45, 0.14, 0.18, 0.26);
  cottageWindow(group, 'east', x1 + 0.008, 0.8, 0.14, 0.18, 0.26, COAST.trim, true);
  battenBlock(group, x1, 0.5, 1.84, 1.0, 0.34, 0xeef2f0);
  roof(group, { x0: x1 - 0.02, z0: 0.46, x1: 1.88, z1: 1.04, y: 0.34, rise: 0.22, color: COAST.seam, ridge: 'x', gableColor: 0xeef2f0, tex: 'seam' });
  cottageWindow(group, 'south', 1.0, 1.58, 0.12, 0.18, 0.18);
  // Deep porch on slim white posts, weathered deck, Adirondack-style chairs.
  deck(group, 0.2, z1, 1.4, 0.36, 0, { color: COAST.deck });
  box(group, 0.2, 0.42, z1, 1.4, 0.03, 0.36, mat(COAST.trim, { rough: 0.6 }));
  for (const x of [0.22, 0.88, 1.56]) box(group, x, 0.014, z1 + 0.3, 0.025, 0.41, 0.025, mat(COAST.trim, { rough: 0.6 }));
  for (const x of [0.32, 1.32]) { box(group, x, 0.014, z1 + 0.12, 0.08, 0.04, 0.08, mat(COAST.blue, { rough: 0.8 })); box(group, x, 0.054, z1 + 0.12, 0.08, 0.06, 0.015, mat(COAST.blue, { rough: 0.8 })); }
  pivotDoor(group, 'south', z1, 0.38, 0.15, 0.36, { color: 0x4d6470, frame: COAST.trim });
  // Dune garden: sand paths, sea grasses, a boardwalk to the street, a weathered fence.
  box(group, 0.1, 0, 1.5, 1.8, 0.008, 0.4, mat(0xe8dcc0, { rough: 1, tex: 'paving', texScale: 0.2 }));
  deck(group, 0.42, 1.46, 0.16, 0.5, 0.004, { color: COAST.deck });
  for (let i = 0; i < 12; i += 1) grass(group, 0.15 + random() * 1.7, 1.55 + random() * 0.32, random, { color: 0x9db06e, tips: 0xe6dcb4 });
  for (let x = 0.7; x < 1.9; x += 0.08) box(group, x, 0, 1.94, 0.012, 0.08 + (x * 37 % 3) * 0.01, 0.012, mat(0xb9a688, { rough: 0.9 }));
  palm(group, 1.75, 1.3, random, { scale: 1.0, lean: 0.25 });
  multiStemTree(group, 0.15, 0.2, random, { scale: 0.9, leaves: 0x8a9f6a });
  for (const x of [0.5, 1.2]) bollardLight(group, x, 1.9);
}

// CONTEMPORARY LEISURE CLUBHOUSE: a gabled boathouse-style hall with a wraparound deck and sea grasses.
function leisureClubhouse(group, random) {
  plate(group, 3, 3, 0x9cbf82);
  const x0 = 0.4, x1 = 2.1, z0 = 0.4, z1 = 1.6, H = 0.55;
  battenBlock(group, x0, z0, x1, z1, H);
  roof(group, { x0: x0 - 0.08, z0: z0 - 0.08, x1: x1 + 0.08, z1: z1 + 0.08, y: H, rise: 0.6, color: COAST.seam, ridge: 'z', gableColor: COAST.white, tex: 'seam' });
  glassWall(group, 'south', z1, x0 + 0.3, 0.02, x1 - x0 - 0.6, 0.48, { bay: 0.16, frame: COAST.trim, lit: true });
  glassWall(group, 'east', x1 + 0.008, z0 + 0.2, 0.06, z1 - z0 - 0.4, 0.34, { bay: 0.2, frame: COAST.trim, lit: true });
  signOn(group, 'south', z1 + 0.01, x0 + 0.45, H + 0.08, 0.8, 0.12, 'DUNE CLUB', { bg: '#f7f7f2', fg: '#4d6470', font: '700 60px Georgia, serif', frame: 0x4d6470 });
  // Wraparound deck with railings, deck chairs, a flagpole and a lifebuoy.
  deck(group, 0.25, z1, 2.5, 0.6, 0, { color: COAST.deck });
  deck(group, x1, 0.25, 0.65, z1 - 0.25, 0, { color: COAST.deck });
  for (let x = 0.3; x < 2.7; x += 0.2) box(group, x, 0.014, z1 + 0.56, 0.015, 0.09, 0.015, mat(COAST.trim));
  box(group, 0.25, 0.1, z1 + 0.56, 2.5, 0.012, 0.02, mat(COAST.trim));
  for (let i = 0; i < 4; i += 1) { const x = 0.5 + i * 0.5; box(group, x, 0.014, z1 + 0.22, 0.09, 0.04, 0.09, mat(i % 2 ? COAST.blue : 0xe9e3d3, { rough: 0.8 })); }
  umbrella(group, 2.4, 2.0, 0x4d6470); umbrella(group, 1.0, 2.05, 0x9fb7c4);
  cylinder(group, 2.7, 0, 2.6, 0.01, 0.012, 0.9, mat(COAST.trim), 8);
  box(group, 2.71, 0.72, 2.6, 0.18, 0.12, 0.005, mat(0x4d6470));
  for (let i = 0; i < 14; i += 1) grass(group, 0.15 + random() * 2.7, 2.35 + random() * 0.5, random, { color: 0x9db06e, tips: 0xe6dcb4 });
  palm(group, 0.2, 2.5, random, { scale: 1.1, lean: 0.2 }); palm(group, 2.8, 0.4, random, { scale: 1.0, lean: 0.3 });
}

// ─── Tropical Contemporary ──────────────────────────────────────────────────────────────────────────────────

// LANAI PAVILION VILLA: a broad hipped shade roof over an open lanai, breeze-block screens, a palm courtyard.
function lanaiVilla(group, random) {
  plate(group, 2, 2, 0x86b06c);
  const x0 = 0.25, x1 = 1.45, z0 = 0.3, z1 = 1.0, H = 0.44;
  box(group, x0, 0, z0, x1 - x0, H, z1 - z0, plasterMat(TROPIC.wall));
  glassWall(group, 'south', z1, x0 + 0.3, 0.02, x1 - x0 - 0.36, H - 0.06, { bay: 0.22, frame: TROPIC.timber, lit: true });
  slats(group, 'south', z1, x0 + 0.04, 0.02, 0.24, H - 0.06, { color: TROPIC.timber, out: 0.03 });
  breezeBlock(group, x1, 0.32, 0.36, 0.36, 'z');
  // Open lanai under a big hipped roof on timber posts, extending east and south.
  deck(group, x0 - 0.05, z1, x1 - x0 + 0.55, 0.42, 0, { color: 0xa98663 });
  deck(group, x1, z0, 0.5, z1 - z0, 0, { color: 0xa98663 });
  for (const [x, z] of [[x0 - 0.03, z1 + 0.36], [0.85, z1 + 0.36], [x1 + 0.45, z1 + 0.36], [x1 + 0.45, z0 + 0.02]]) box(group, x, 0.014, z, 0.035, H + 0.02, 0.035, woodMat(TROPIC.timber));
  roof(group, { x0: x0 - 0.12, z0: z0 - 0.12, x1: x1 + 0.6, z1: z1 + 0.44, y: H + 0.04, rise: 0.24, color: TROPIC.roof, ridge: 'x', hip: true, tex: 'slate' });
  box(group, x0 - 0.12, H + 0.015, z0 - 0.12, x1 - x0 + 0.72, 0.025, z1 - z0 + 0.56, woodMat(0x9c7a55));
  lightLine(group, x0, H - 0.03, z1 + 0.42, x1 - x0 + 0.4, 0.006, 0.01);
  lounge(group, x1 + 0.06, z0 + 0.1, { axis: 'z' }); diningSet(group, 0.5, z1 + 0.14);
  // Palm courtyard and plunge pool, banana plants, fan palms, a stone path.
  pool(group, 0.9, 1.56, 0.7, 0.26, { water: 0x45b2bf, coping: 0xe0d2b6 });
  palm(group, 1.82, 1.4, random, { scale: 1.2, lean: 0.15 });
  palm(group, 0.22, 1.7, random, { scale: 1.05, lean: 0.25 });
  bananaPlant(group, 1.8, 0.3, random, { scale: 1.0 }); bananaPlant(group, 0.14, 0.4, random, { scale: 0.9 });
  fanPalm(group, 1.84, 1.86, random, { scale: 0.85 });
  steppingStones(group, 0.62, 1.44, 4, 'z', { size: 0.11, gap: 0.03 });
  for (let i = 0; i < 6; i += 1) shrub(group, 0.85 + i * 0.16, 1.92, random, { scale: 0.9, color: 0x4f8a4a });
  bollardLight(group, 0.55, 1.92);
}

// CONTEMPORARY SHOPPING PAVILION: shops under a sweeping timber canopy around a planted courtyard.
function shoppingPavilion(group, random, W, D) {
  plate(group, W, D, 0x86b06c);
  terrace(group, 0.1, 0.1, W - 0.2, D - 0.2, 0, { color: 0xe8dcc6 });
  const z0 = 0.3, depth = 0.9, H = 0.62;
  // Shop wings along the back and the west side, glass fronts facing the courtyard.
  box(group, 0.3, 0, z0, W - 0.6, H, depth, plasterMat(TROPIC.wall));
  box(group, 0.3, 0, z0 + depth, 0.9, H, D - z0 - depth - 0.9, plasterMat(TROPIC.wall));
  glassWall(group, 'south', z0 + depth, 1.25, 0.02, W - 1.6, H - 0.12, { bay: 0.24, frame: TROPIC.timber, lit: true });
  glassWall(group, 'east', 1.2, z0 + depth + 0.05, 0.02, D - z0 - depth - 1.0, H - 0.12, { bay: 0.24, frame: TROPIC.timber, lit: true });
  glassWall(group, 'east', W - 0.3, z0 + 0.05, 0.02, depth - 0.1, H - 0.12, { bay: 0.2, frame: TROPIC.timber, lit: true });
  // The sweeping timber canopy: a deep slatted roof over a colonnade on timber posts, a gentle hip above.
  roof(group, { x0: 0.15, z0: z0 - 0.15, x1: W - 0.15, z1: z0 + depth + 0.45, y: H, rise: 0.32, color: TROPIC.roof, ridge: 'x', hip: true, tex: 'slate' });
  roof(group, { x0: 0.15, z0: z0 + depth, x1: 1.65, z1: D - 0.75, y: H, rise: 0.3, color: TROPIC.roof, ridge: 'z', hip: true, tex: 'slate' });
  for (let x = 1.3; x < W - 0.2; x += 0.5) box(group, x, 0, z0 + depth + 0.4, 0.035, H, 0.035, woodMat(TROPIC.timber));
  const names = ['BATIK', 'KOPI', 'SOL', 'MANGO', 'REEF'];
  for (let i = 0; i < Math.floor((W - 1.6) / 0.9); i += 1) signOn(group, 'south', z0 + depth + 0.01, 1.35 + i * 0.9, H - 0.11, 0.55, 0.08, names[i % names.length], { bg: '#5b4a3a', fg: '#f3e2c0', font: '700 56px Georgia, serif', frame: 0x8c6a46 });
  // Courtyard: lawn island with palms, a pond with stepping stones, benches.
  box(group, 1.8, 0, z0 + depth + 0.7, W - 2.4, 0.04, D - z0 - depth - 1.5, stone(0xd8c9ae));
  box(group, 1.84, 0.04, z0 + depth + 0.74, W - 2.48, 0.01, D - z0 - depth - 1.58, mat(0x86b06c, { rough: 1, tex: 'grass' }));
  const isle = new THREE.Group(); isle.position.y = 0.05; group.add(isle);
  for (let i = 0; i < 3; i += 1) palm(isle, 2.1 + i * (W - 2.8) / 2, z0 + depth + 1.0 + (i % 2) * 0.3, random, { scale: 1.2, lean: 0.15 });
  for (let i = 0; i < 6; i += 1) bananaPlant(isle, 1.95 + i * (W - 2.6) / 5, D - 1.1, random, { scale: 0.8 });
  // Café terrace under umbrellas along the colonnade, and shrub beds on the island.
  for (let i = 0; i < 3; i += 1) { const x = 1.6 + i * (W - 2.2) / 2.5, z = z0 + depth + 0.5; diningSet(group, x, z); umbrella(group, x + 0.06, z + 0.04, i % 2 ? 0xd8735b : 0xe9dfc8); }
  for (let i = 0; i < 10; i += 1) shrub(isle, 1.95 + random() * (W - 2.7), z0 + depth + 0.85 + random() * (D - z0 - depth - 1.8), random, { scale: 1.1, color: pick(random, [0x4f8a4a, 0x5f9a50]), flowers: random() < 0.35 ? 0xf08a5a : null });
  for (let x = 0.4; x < W - 0.2; x += 0.6) bollardLight(group, x, D - 0.12);
  for (let x = 1.6; x < W - 0.4; x += 1.0) box(group, x, 0, D - 0.5, 0.36, 0.05, 0.1, woodMat(TROPIC.timber));
}

// ROOFTOP GARDEN OFFICE: terraced floors with planted edges, timber louvres and a roof garden.
function rooftopGardenOffice(group, random) {
  plate(group, 4, 4, 0x86b06c);
  terrace(group, 0.08, 0.08, 3.84, 3.84, 0, { color: 0xe4dbc9 });
  const F = 0.44, floors = 6;
  for (let f = 0; f < floors; f += 1) {
    const inset = f > 2 ? 0.25 : 0, x0 = 0.5, z0 = 0.4, x1 = 3.4 - inset, z1 = 3.0 - inset, y = f * F;
    box(group, x0, y, z0, x1 - x0, F, z1 - z0, mat(0x30383d, { rough: 0.9 }));
    glassWall(group, 'south', z1, x0 + 0.05, y + 0.03, x1 - x0 - 0.1, F - 0.08, { bay: 0.22, frame: TROPIC.timber, lit: (i) => ((i * 3 + f) % 5) > 1 });
    glassWall(group, 'east', x1, z0 + 0.05, y + 0.03, z1 - z0 - 0.1, F - 0.08, { bay: 0.22, frame: TROPIC.timber, lit: (i) => ((i + f * 2) % 4) > 0 });
    slats(group, 'south', z1, x0 + 0.05, y + 0.03, x1 - x0 - 0.1, F - 0.08, { horizontal: true, color: TROPIC.timber, out: 0.04, gap: 0.08, size: 0.016 });
    // Planted edge on every floor slab.
    box(group, x0 - 0.06, y + F - 0.04, z0 - 0.06, x1 - x0 + 0.12, 0.04, z1 - z0 + 0.12, plasterMat(TROPIC.wall));
    const g = new THREE.Group(); g.position.y = y + F; group.add(g);
    planterBox(g, x0 - 0.04, z1 - 0.02, x1 - x0 + 0.08, 0.06, random, { h: 0.04, plants: 'mix', color: TROPIC.wall });
    planterBox(g, x1 - 0.02, z0 - 0.04, 0.06, z1 - z0 + 0.08, random, { h: 0.04, plants: 'mix', color: TROPIC.wall });
  }
  roofGarden(group, 0.56, 0.46, 3.1, 2.7, floors * F, random);
  for (const [x, z] of [[1.0, 1.0], [2.4, 1.6], [1.6, 2.2]]) multiStemTree(group, x, z, random, { scale: 1.1, leaves: 0x5f8f4f });
  // Garden plaza: palms, a water channel, lobby canopy.
  box(group, 1.4, F - 0.04, 3.0, 1.0, 0.03, 0.45, woodMat(TROPIC.timber));
  pivotDoor(group, 'south', 3.0, 1.75, 0.3, 0.38, { color: TROPIC.timber });
  for (const [x, z] of [[0.3, 3.5], [3.6, 3.5], [3.6, 1.2], [3.6, 2.3]]) palm(group, x, z, random, { scale: 1.3, lean: 0.12 });
  pool(group, 0.4, 3.3, 0.9, 0.18, { water: 0x45b2bf });
  for (let i = 0; i < 6; i += 1) bananaPlant(group, 2.3 + i * 0.22, 3.6, random, { scale: 0.7 });
}

// TROPICAL RESORT CLUBHOUSE: a tall pavilion roof over an open bar with a pool deck and palms.
function resortClubhouse(group, random) {
  plate(group, 3, 3, 0x86b06c);
  deck(group, 0.3, 0.3, 2.4, 2.4, 0, { color: 0xa98663 });
  // Open pavilion: timber posts, a tall steep hip roof with a raised ridge vent, a round bar beneath.
  const x0 = 0.6, x1 = 2.0, z0 = 0.5, z1 = 1.7;
  for (const [x, z] of [[x0, z0], [x1 - 0.04, z0], [x0, z1 - 0.04], [x1 - 0.04, z1 - 0.04], [(x0 + x1) / 2, z1 - 0.04], [x1 - 0.04, (z0 + z1) / 2]]) box(group, x, 0, z, 0.045, 0.5, 0.045, woodMat(TROPIC.timber));
  roof(group, { x0: x0 - 0.25, z0: z0 - 0.25, x1: x1 + 0.25, z1: z1 + 0.25, y: 0.5, rise: 0.75, color: 0x8a6b45, ridge: 'x', hip: true, tex: 'planks' });
  roof(group, { x0: x0 + 0.3, z0: z0 + 0.35, x1: x1 - 0.3, z1: z1 - 0.35, y: 1.12, rise: 0.25, color: 0x7a5d3b, ridge: 'x', hip: true, tex: 'planks' });
  cylinder(group, 1.3, 0, 1.1, 0.3, 0.3, 0.18, woodMat(0x6b4a33), 24);
  cylinder(group, 1.3, 0.18, 1.1, 0.33, 0.33, 0.02, mat(0xe9dfcc), 24);
  for (let i = 0; i < 6; i += 1) { const a = i / 6 * Math.PI * 2; cylinder(group, 1.3 + Math.cos(a) * 0.45, 0, 1.1 + Math.sin(a) * 0.45, 0.035, 0.035, 0.1, mat(0xe9dfcc), 10); }
  for (let i = 0; i < 8; i += 1) { const lamp = sphere(group, x0 + 0.1 + i * 0.17, 0.46, z1 + 0.15, 0.018, mat(0xffe6b0)); lamp.userData.lamp = true; }
  signOn(group, 'south', z1 + 0.25, x0 + 0.2, 0.52, 1.0, 0.1, 'LAGOON BAR', { bg: '#5b4a3a', fg: '#f3e2c0', font: '700 56px Georgia, serif', frame: 0x8c6a46 });
  // Pool deck: free-form pool, daybeds, palms and bananas.
  pool(group, 0.5, 2.05, 1.9, 0.5, { water: 0x40b4c4, coping: 0xe0d2b6 });
  loungers(group, 2.3, 0.6, 3, { axis: 'x' });
  for (const [x, z] of [[0.25, 0.3], [2.75, 0.3], [2.75, 2.7], [0.2, 2.7]]) palm(group, x, z, random, { scale: 1.25, lean: 0.2 });
  for (let i = 0; i < 5; i += 1) bananaPlant(group, 2.75, 0.8 + i * 0.36, random, { scale: 0.8 });
}

// MODERN RESORT POOL: a free-form lagoon pool with a swim-up island, daybeds and palms.
function resortPool(group, random, W, D) {
  plate(group, W, D, 0x86b06c);
  terrace(group, 0.1, 0.1, W - 0.2, D - 0.2, 0, { color: 0xeadbc0 });
  // Lagoon: overlapping rounded basins (cylinders) of water with a sandy coping.
  const basins = W >= D ? [[0.9, 0.95, 0.7], [1.9, 1.2, 0.75], [2.9, 0.95, 0.6]] : [[0.95, 0.9, 0.7], [1.2, 1.9, 0.75], [0.95, 2.9, 0.6]];
  const water = new THREE.MeshPhysicalMaterial({ color: 0x3fb3c4, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.5 });
  for (const [x, z, r] of basins) cylinder(group, x, 0, z, r + 0.05, r + 0.05, 0.02, stoneMat(0xe6d6b8), 32);
  for (const [x, z, r] of basins) cylinder(group, x, 0.008, z, r, r, 0.02, water, 32);
  // Swim-up island with a palm and a thatch umbrella.
  const [ix, iz] = basins[1];
  cylinder(group, ix, 0.01, iz, 0.2, 0.22, 0.04, stoneMat(0xe6d6b8), 20);
  palm(group, ix, iz, random, { scale: 1.1, lean: 0.1 });
  // Daybeds under timber canopies and palms around the lagoon.
  for (let i = 0; i < 3; i += 1) {
    const x = W >= D ? 0.4 + i * 1.0 : W - 0.7, z = W >= D ? D - 0.6 : 0.4 + i * 1.0;
    slimPergola(group, x, z, 0.4, 0.34, 0.24, { beams: 6, color: TROPIC.timber, beamColor: 0xb9935f });
    box(group, x + 0.04, 0.02, z + 0.04, 0.32, 0.04, 0.26, mat(0xf3ece0, { rough: 0.95, tex: 'fabric' }));
  }
  for (let i = 0; i < 6; i += 1) palm(group, i % 2 ? 0.2 : W - 0.2, 0.3 + i * (D - 0.6) / 5, random, { scale: 1.05 + (i % 3) * 0.1, lean: 0.2 });
  for (let i = 0; i < 5; i += 1) bananaPlant(group, 0.4 + i * (W - 0.8) / 4, 0.2, random, { scale: 0.8 });
}

// TROPICAL GARDEN PARK: dense tropical planting, a boardwalk loop and a shaded pavilion over a pond.
function tropicalGardenPark(group, random) {
  plate(group, 4, 4, 0x7fac65);
  // Pond with a timber pavilion on stilts.
  pool(group, 1.3, 1.3, 1.4, 1.1, { water: 0x4a9fa8, coping: 0x8e7b5e });
  deck(group, 1.9, 1.6, 0.5, 0.5, 0.06, { color: 0xa98663 });
  for (const [x, z] of [[1.92, 1.62], [2.36, 1.62], [1.92, 2.06], [2.36, 2.06]]) box(group, x, 0, z, 0.03, 0.42, 0.03, woodMat(TROPIC.timber));
  roof(group, { x0: 1.82, z0: 1.52, x1: 2.48, z1: 2.18, y: 0.42, rise: 0.3, color: 0x7a5d3b, ridge: 'x', hip: true, tex: 'planks' });
  // Boardwalk loop around the pond.
  for (const [x, z, w, d] of [[0.6, 0.6, 2.8, 0.22], [0.6, 2.8, 2.8, 0.22], [0.6, 0.6, 0.22, 2.42], [3.18, 0.6, 0.22, 2.42], [2.1, 2.1, 0.2, 0.7]]) deck(group, x, z, w, d, 0.02, { color: 0xa98663 });
  // Dense tropical planting outside the loop and on islands.
  for (let i = 0; i < 14; i += 1) {
    const edge = i % 4, t = (i / 14) * 3.6 + 0.2;
    const [x, z] = edge === 0 ? [t, 0.25] : edge === 1 ? [3.75, t] : edge === 2 ? [t, 3.75] : [0.25, t];
    const pickOne = i % 3;
    if (pickOne === 0) palm(group, x, z, random, { scale: 1.1 + random() * 0.3, lean: 0.2 });
    else if (pickOne === 1) bananaPlant(group, x, z, random, { scale: 1.0 });
    else fanPalm(group, x, z, random, { scale: 0.9 });
  }
  for (let i = 0; i < 18; i += 1) shrub(group, 0.35 + random() * 3.3, i % 2 ? 0.45 + random() * 0.1 : 3.5 + random() * 0.1, random, { scale: 1.1, color: pick(random, [0x4f8a4a, 0x5f9a50, 0x3f7a45]), flowers: random() < 0.3 ? 0xe86a8a : null });
  for (let i = 0; i < 6; i += 1) bollardLight(group, 0.7 + i * 0.5, 2.92);
}

// ─── Urban Premium ──────────────────────────────────────────────────────────────────────────────────────────

/** Paved urban plaza for 4×4 lots. */
function urbanPlaza(group, color = 0xdcdad4) {
  plate(group, 4, 4, LAWN);
  terrace(group, 0.06, 0.06, 3.88, 3.88, 0, { color });
  for (let x = 0.3; x < 3.8; x += 0.5) bollardLight(group, x, 3.88);
}

// MODERN GLASS OFFICE: a sleek curtain-wall office with a rounded corner and a glowing lobby.
function modernGlassOffice(group, random) {
  urbanPlaza(group);
  const x0 = 0.5, x1 = 3.2, z0 = 0.4, z1 = 2.9, F = 0.42, floors = 8, r = 0.5;
  box(group, x0, 0, z0, x1 - x0 - r, F * floors, z1 - z0, mat(0x24323c, { rough: 0.9 }));
  box(group, x0, 0, z0, x1 - x0, F * floors, z1 - z0 - r, mat(0x24323c, { rough: 0.9 }));
  // Rounded south-east corner: a quarter cylinder of glass.
  const corner = new THREE.Mesh(new THREE.CylinderGeometry(r, r, F * floors, 24, 1, false, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: URBAN.glass, roughness: 0.08, metalness: 0.2, clearcoat: 1 }));
  corner.position.set(x1 - r, F * floors / 2, z1 - r); corner.castShadow = true; corner.userData.window = true; corner.userData.lit = true; group.add(corner);
  for (let f = 0; f <= floors; f += 1) {
    const y = f * F;
    if (f < floors) {
      glassWall(group, 'south', z1, x0, y + 0.02, x1 - x0 - r, F - 0.04, { bay: 0.2, frame: URBAN.frame, tint: URBAN.glass, lit: f === 0 ? true : (i) => ((i * 7 + f * 3) % 5) > 1 });
      glassWall(group, 'east', x1, z0, y + 0.02, z1 - z0 - r, F - 0.04, { bay: 0.2, frame: URBAN.frame, tint: URBAN.glass, lit: f === 0 ? true : (i) => ((i * 3 + f * 5) % 6) > 1 });
    }
    // Slim silver floor lines, including round the curved corner.
    box(group, x0, y - 0.01, z1, x1 - x0 - r, 0.02, 0.02, metal(0xc8cdd0));
    box(group, x1, y - 0.01, z0, 0.02, 0.02, z1 - z0 - r, metal(0xc8cdd0));
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.02, r + 0.02, 0.02, 24, 1, true, 0, Math.PI / 2), metal(0xc8cdd0));
    ring.position.set(x1 - r, y, z1 - r); group.add(ring);
  }
  slab(group, x0 - 0.02, z0 - 0.02, x1 + 0.02 - r, z1 + 0.02, F * floors, { t: 0.04, color: 0x3a444a, reveal: false });
  roofDeck(group, x0 + 0.1, z0 + 0.1, x1 - 0.2, z1 - 0.6, F * floors, { color: 0x9aa0a4, edge: 0x3a444a });
  box(group, x0 + 0.6, F * floors, z0 + 0.5, 1.0, 0.24, 0.8, metal(0xb9bec2));
  // Glowing double-height lobby, a canopy and a sculpture on the plaza.
  box(group, 1.2, F * 2 - 0.04, z1, 1.2, 0.03, 0.45, metal(URBAN.frame));
  lightLine(group, 1.25, F * 2 - 0.05, z1 + 0.4, 1.1, 0.008, 0.012);
  signOn(group, 'south', z1 + 0.02, 1.35, F * 2 + 0.03, 0.9, 0.12, 'MERIDIAN', { bg: '#2b3338', fg: '#e9d39c', font: '700 58px Georgia, serif', frame: 0x2b3338 });
  sphere(group, 0.5, 0.2, 3.4, 0.16, metal(0xc9cfd3), 3);
  for (const [x, z] of [[3.6, 0.6], [3.6, 1.6], [2.8, 3.5], [1.6, 3.5]]) { planterBox(group, x - 0.15, z - 0.15, 0.3, 0.3, random, { color: 0x6d7378 }); multiStemTree(group, x, z, random, { scale: 1.1, leaves: 0x7d9a5e }); }
}

// PREMIUM COMMERCIAL TOWER: a tall tower with vertical bronze fins, setbacks and an illuminated crown.
function premiumTower(group, random) {
  urbanPlaza(group, 0xd6d3cc);
  const F = 0.4;
  const tiers = [[0.6, 0.5, 3.3, 3.1, 4], [0.9, 0.75, 3.0, 2.85, 3], [1.15, 1.0, 2.75, 2.6, 3]];
  let y = 0;
  for (const [x0, z0, x1, z1, floors] of tiers) {
    const h = floors * F;
    box(group, x0, y, z0, x1 - x0, h, z1 - z0, mat(0x232c33, { rough: 0.9 }));
    glassWall(group, 'south', z1, x0, y + 0.02, x1 - x0, h - 0.04, { bay: 0.18, frame: URBAN.frame, tint: 0x8aa6b8, lit: (i) => ((i * 7) % 5) > 1 });
    glassWall(group, 'east', x1, z0, y + 0.02, z1 - z0, h - 0.04, { bay: 0.18, frame: URBAN.frame, tint: 0x8aa6b8, lit: (i) => ((i * 3) % 4) > 0 });
    fins(group, 'south', z1, x0 + 0.02, y, x1 - x0 - 0.04, h, { count: Math.round((x1 - x0) * 7), depth: 0.07, material: bronze() });
    fins(group, 'east', x1, z0 + 0.02, y, z1 - z0 - 0.04, h, { count: Math.round((z1 - z0) * 7), depth: 0.07, material: bronze() });
    y += h;
    box(group, x0 - 0.02, y, z0 - 0.02, x1 - x0 + 0.04, 0.05, z1 - z0 + 0.04, mat(0xd9c49a, { rough: 0.4, metal: 0.6 }));
    y += 0.05;
  }
  // Illuminated crown: a glowing glass lantern with a spire.
  const lantern = box(group, 1.35, y, 1.2, 1.2, 0.36, 1.2, new THREE.MeshPhysicalMaterial({ color: 0xe9d39c, roughness: 0.2, metalness: 0.2, clearcoat: 1 }));
  lantern.userData.window = true; lantern.userData.lit = true;
  fins(group, 'south', 2.4, 1.35, y, 1.2, 0.36, { count: 10, depth: 0.04, material: bronze() });
  fins(group, 'east', 2.55, 1.2, y, 1.2, 0.36, { count: 10, depth: 0.04, material: bronze() });
  slab(group, 1.3, 1.15, 2.6, 2.45, y + 0.36, { t: 0.05, color: 0xd9c49a, reveal: false });
  cylinder(group, 1.95, y + 0.41, 1.8, 0.008, 0.02, 0.5, bronze(), 8);
  // Podium entrance and plaza: lit canopy, water wall, planters, parked cars.
  box(group, 1.4, F - 0.04, 3.1, 1.3, 0.03, 0.45, bronze());
  lightLine(group, 1.45, F - 0.05, 3.5, 1.2, 0.008, 0.012);
  signOn(group, 'south', 3.12, 1.55, F + 0.01, 1.0, 0.1, 'AURUM TOWER', { bg: '#232c33', fg: '#e9d39c', font: '700 52px Georgia, serif', frame: 0xc9a46a });
  for (const x of [0.3, 3.5]) for (let z = 0.5; z < 3.4; z += 0.7) columnTree(group, x, z, { scale: 1.2 });
  car(group, 3.1, 3.55, 0, CAR_COLORS[6], random); car(group, 0.5, 3.55, 0, CAR_COLORS[3], random);
}

// PREMIUM GLASS MALL: a glass mall with a cantilevered entrance canopy and a media wall.
function premiumGlassMall(group, random, W, D) {
  plate(group, W, D, LAWN);
  terrace(group, 0.08, D - 1.3, W - 0.16, 1.2, 0, { color: 0xdcdad4 });
  const bx0 = 0.25, bx1 = W - 0.25, bz0 = 0.3, bz1 = D - 1.4, H = 1.1;
  box(group, bx0, 0, bz0, bx1 - bx0, H, bz1 - bz0, mat(0x26323a, { rough: 0.9 }));
  glassWall(group, 'south', bz1, bx0, 0.02, bx1 - bx0, H - 0.06, { bay: 0.24, frame: URBAN.frame, tint: 0x9db8c8, lit: true, transom: true });
  glassWall(group, 'east', bx1, bz0, 0.02, bz1 - bz0, H - 0.06, { bay: 0.24, frame: URBAN.frame, tint: 0x9db8c8, lit: true, transom: true });
  box(group, bx0, H / 2, bz1, bx1 - bx0, 0.03, 0.04, metal(0xc8cdd0));
  // Media wall: a large lit panel on the east of the frontage.
  const media = signOn(group, 'south', bz1 + 0.04, bx1 - 1.6, 0.25, 1.3, 0.65, 'SKYLINE', { bg: '#e9a24b', fg: '#2b2440', font: '800 120px Georgia, serif', frame: 0x1c2328 });
  media.userData.sign = true;
  // Cantilevered entrance canopy: a dramatic angled plate on one mast.
  const canopy = box(group, 0.8, H - 0.1, bz1, 1.6, 0.05, 0.9, metal(0xe8eaec));
  canopy.rotation.x = -0.08;
  box(group, 1.55, 0, bz1 + 0.75, 0.04, H - 0.08, 0.04, metal(URBAN.frame));
  lightLine(group, 0.85, H - 0.13, bz1 + 0.84, 1.5, 0.008, 0.012);
  slab(group, bx0 - 0.04, bz0 - 0.04, bx1 + 0.04, bz1 + 0.04, H, { t: 0.05, color: 0x3a444a, reveal: false });
  roofDeck(group, bx0, bz0, bx1, bz1, H + 0.05, { color: 0x9aa0a4, edge: 0x3a444a });
  for (let x = bx0 + 0.4; x < bx1 - 0.6; x += 1.0) skylight(group, x, bz0 + 0.3, 0.6, 0.4, H + 0.065);
  for (let x = 0.4; x < W - 0.2; x += 0.6) bollardLight(group, x, D - 0.12);
  for (let x = 2.8; x < W - 0.3; x += 0.7) { planterBox(group, x - 0.15, D - 0.85, 0.3, 0.3, random, { color: 0x6d7378 }); multiStemTree(group, x, D - 0.7, random, { scale: 1.05 }); }
}

// MODERN URBAN PARK: geometric lawns, a sunken amphitheatre and planted bosques in a paved grid.
function urbanPark(group, random) {
  urbanPlaza(group, 0xd9d6cf);
  // Paved grid with lawn squares.
  for (const [x, z] of [[0.3, 0.3], [0.3, 2.2]]) {
    box(group, x, 0, z, 1.5, 0.03, 1.5, concrete(0xbfbab0));
    box(group, x + 0.05, 0.03, z + 0.05, 1.4, 0.01, 1.4, mat(0x8fb377, { rough: 1, tex: 'grass' }));
  }
  // Tree bosque in a grid on the first square.
  const bosque = new THREE.Group(); bosque.position.y = 0.04; group.add(bosque);
  for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) multiStemTree(bosque, 0.55 + i * 0.5, 0.55 + j * 0.5, random, { scale: 1.1, leaves: 0x6f9658, stems: 2 });
  // Sunken amphitheatre: stepped concrete rings.
  for (let k = 0; k < 4; k += 1) box(group, 2.25 + k * 0.1, 0.03 + k * 0.03, 2.25 + k * 0.1, 1.4 - k * 0.2, 0.03, 1.4 - k * 0.2, concrete(0xd8d4cb - k * 0x050505));
  box(group, 2.75, 0.15, 2.75, 0.4, 0.01, 0.4, mat(0x8fb377, { rough: 1, tex: 'grass' }));
  // Grasses square with a water jet table.
  const grasses = new THREE.Group(); grasses.position.y = 0.04; group.add(grasses);
  for (let i = 0; i < 16; i += 1) grass(grasses, 0.45 + (i % 4) * 0.36, 2.35 + Math.floor(i / 4) * 0.36, random, { scale: 1.2 });
  pool(group, 2.35, 0.45, 1.25, 1.25, { water: 0x4ea8b6, coping: 0xc9c4ba });
  for (const [x, z] of [[2.2, 0.25], [3.75, 0.25], [3.75, 1.8]]) multiStemTree(group, x, z, random, { scale: 1.0, leaves: 0x7d9a5e });
  for (let i = 0; i < 9; i += 1) { const jet = box(group, 2.55 + (i % 3) * 0.4, 0.03, 0.65 + Math.floor(i / 3) * 0.4, 0.02, 0.12, 0.02, new THREE.MeshPhysicalMaterial({ color: 0xd8f0f4, transparent: true, opacity: 0.7, roughness: 0.1 })); jet.castShadow = false; }
  for (let x = 0.2; x < 3.9; x += 0.4) box(group, x, 0, 1.9, 0.3, 0.05, 0.1, mat(0xb0763f, { rough: 0.7 }));
}

// ─── Family Garden ──────────────────────────────────────────────────────────────────────────────────────────

// GARDEN PORCH HOME: a gabled family home with a wraparound porch, vegetable beds, a play lawn and a swing.
function gardenPorch(group, random) {
  plate(group, 2, 2, 0x8fbb72);
  const x0 = 0.25, x1 = 1.3, z0 = 0.25, z1 = 0.95, H = 0.5;
  box(group, x0, 0, z0, x1 - x0, H, z1 - z0, wallMat(FAMILY.wall));
  roof(group, { x0: x0 - 0.08, z0: z0 - 0.08, x1: x1 + 0.08, z1: z1 + 0.1, y: H, rise: 0.42, color: FAMILY.roof, ridge: 'x', gableColor: FAMILY.wall });
  // Dormer, chimney, windows with flower boxes.
  box(group, 0.6, H + 0.1, z1 - 0.05, 0.3, 0.22, 0.2, wallMat(FAMILY.wall));
  roof(group, { x0: 0.57, z0: z1 - 0.08, x1: 0.93, z1: z1 + 0.18, y: H + 0.32, rise: 0.12, color: FAMILY.roof, ridge: 'z', gableColor: FAMILY.wall });
  cottageWindow(group, 'south', z1 + 0.15, 0.67, H + 0.14, 0.16, 0.13, FAMILY.trim, true);
  box(group, 1.08, H + 0.05, 0.4, 0.1, 0.4, 0.1, stoneMat(0xc9a98a));
  for (const u of [0.35, 0.95]) { cottageWindow(group, 'south', z1, u, 0.12, 0.18, 0.24, FAMILY.trim, u > 0.5); box(group, u - 0.01, 0.1, z1 + 0.02, 0.2, 0.03, 0.05, woodMat(FAMILY.timber)); }
  cottageWindow(group, 'east', x1, 0.45, 0.12, 0.2, 0.24);
  // Wraparound porch: deck, white posts, rail, porch roof, rocking chairs.
  deck(group, x0 - 0.05, z1, x1 - x0 + 0.4, 0.3, 0, { color: 0xc49a6c });
  deck(group, x1, z0 + 0.1, 0.3, z1 - z0 - 0.1, 0, { color: 0xc49a6c });
  box(group, x0 - 0.05, 0.38, z1, x1 - x0 + 0.4, 0.025, 0.32, mat(FAMILY.trim));
  box(group, x1, 0.38, z0 + 0.1, 0.32, 0.025, z1 - z0, mat(FAMILY.trim));
  for (const [x, z] of [[x0 - 0.04, z1 + 0.27], [0.75, z1 + 0.27], [x1 + 0.3, z1 + 0.27], [x1 + 0.3, z0 + 0.12]]) box(group, x, 0.014, z, 0.025, 0.37, 0.025, mat(FAMILY.trim));
  for (let x = x0; x < x1 + 0.3; x += 0.06) box(group, x, 0.014, z1 + 0.28, 0.01, 0.08, 0.01, mat(FAMILY.trim));
  pivotDoor(group, 'south', z1, 0.66, 0.15, 0.34, { color: 0x3f8d8a, frame: FAMILY.trim });
  // Garden: vegetable beds, play lawn with a swing, a tree, a picket fence, a path.
  for (let i = 0; i < 3; i += 1) { box(group, 1.4, 0, 1.25 + i * 0.2, 0.45, 0.05, 0.14, woodMat(0x9c7a55)); for (let k = 0; k < 4; k += 1) sphere(group, 1.46 + k * 0.1, 0.07, 1.32 + i * 0.2, 0.03, leafMat(k % 2 ? 0x6f9e5c : 0x8fbf6a), 1); }
  broadleaf(group, 0.3, 1.45, random, { scale: 1.1, leaves: 'round' });
  for (const x of [0.52, 0.78]) box(group, x, 0, 1.6, 0.02, 0.32, 0.02, woodMat(FAMILY.timber));
  box(group, 0.5, 0.32, 1.6, 0.3, 0.02, 0.02, woodMat(FAMILY.timber));
  box(group, 0.6, 0.1, 1.59, 0.1, 0.012, 0.04, mat(0xe86a5a));
  flowerbed(group, 0.12, 1.05, 0.4, 0.14, random);
  path(group, 0.66, 1.25, 0.16, 0.7, 0xe8dcc6);
  picketFence(group, 0.04, 1.94, 0.6, 'x'); picketFence(group, 0.86, 1.94, 1.1, 'x');
  shrub(group, 1.85, 0.3, random, { scale: 1.2, flowers: 0xf4a6b8 });
}

// LANDSCAPED COMMUNITY POOL: a family pool with a splash pad, shaded lawn and picnic tables in a garden.
function communityPool(group, random, W, D) {
  plate(group, W, D, 0x8fbb72);
  const long = W >= D;
  terrace(group, 0.3, 0.3, long ? W - 1.4 : W - 0.6, long ? D - 0.6 : D - 1.4, 0, { color: 0xf0e6d2 });
  pool(group, 0.5, 0.5, long ? W - 1.8 : W - 1.3, long ? D - 1.6 : D - 2.2, { water: 0x4cbdd0, coping: 0xe8dcc4 });
  // Splash pad with coloured jets and a little slide.
  const sx = long ? W - 1.0 : 0.6, sz = long ? 0.5 : D - 1.0;
  box(group, sx, 0, sz, 0.6, 0.012, 0.6, mat(0x7cc6d3, { rough: 0.6 }));
  for (let i = 0; i < 5; i += 1) cylinder(group, sx + 0.1 + (i % 3) * 0.2, 0.012, sz + 0.15 + Math.floor(i / 3) * 0.3, 0.02, 0.02, 0.08, mat(pick(random, [0xe86a5a, 0xf1c45f, 0x5fb0aa]), { rough: 0.5 }), 10);
  playground(group, long ? 0.4 : W - 0.8, long ? D - 0.7 : 0.6, random);
  // Shaded lawn: big trees, picnic tables, umbrellas, a hedge around.
  for (let i = 0; i < 3; i += 1) { const x = long ? 1.3 + i * 0.8 : W - 0.32, z = long ? D - 0.32 : 1.3 + i * 0.8; broadleaf(group, x, z, random, { scale: 1.0 }); picnicTable(group, long ? x - 0.2 : x - 0.45, long ? z - 0.4 : z - 0.1); }
  umbrella(group, long ? 0.8 : W - 0.9, long ? 1.6 : 1.0, FAMILY.roof);
  hedge(group, 0.04, 0.04, W - 0.08, 'x', { h: 0.12, w: 0.08 }); hedge(group, 0.04, 0.12, D - 0.2, 'z', { h: 0.12, w: 0.08 });
  for (let x = 0.4; x < W - 0.2; x += 0.5) flowerbed(group, x, D - 0.16, 0.3, 0.1, random);
}

const two = (id, kind, w, d, build, seed) => ['S', 'E'].map((front) => ({ id: `${id}.${front}`, model: id, kind, variant: 0, front, footprint: { w, d }, build: (g) => { build(g, rng(seed)); return g; } }));
const par = (id, kind, w, d, build, seed) => [
  { id: `${id}.S`, model: id, kind, variant: 0, front: 'S', footprint: { w, d }, build: (g) => { build(g, rng(seed), w, d); return g; } },
  { id: `${id}.E`, model: id, kind, variant: 0, front: 'E', footprint: { w, d }, build: (g) => { build(g, rng(seed + 1), d, w); return g; } },
];
const one = (id, kind, w, d, build, seed) => [{ id: `${id}.S`, model: id, kind, variant: 0, front: 'S', footprint: { w, d }, build: (g) => { build(g, rng(seed)); return g; } }];

export function collectionAssets() {
  return [
    ...two('mc.villa.shoreline', 'villa', 2, 2, shorelineVilla, 36_000),
    ...two('mc.clubhouse.leisure', 'clubhouse', 3, 3, leisureClubhouse, 36_100),
    ...two('tc.villa.lanai', 'villa', 2, 2, lanaiVilla, 36_200),
    ...par('tc.mall.shopping-pavilion', 'mall', 6, 5, shoppingPavilion, 36_300),
    ...two('tc.office.rooftop-garden', 'office', 4, 4, rooftopGardenOffice, 36_400),
    ...two('tc.clubhouse.resort', 'clubhouse', 3, 3, resortClubhouse, 36_500),
    ...par('tc.pool.resort', 'pool', 3, 4, resortPool, 36_600),
    ...one('tc.park.tropical-garden', 'park', 4, 4, tropicalGardenPark, 36_700),
    ...two('up.office.glass', 'office', 4, 4, modernGlassOffice, 36_800),
    ...two('up.office.premium-tower', 'office', 4, 4, premiumTower, 36_900),
    ...par('up.mall.glass', 'mall', 6, 5, premiumGlassMall, 37_000),
    ...one('up.park.urban', 'park', 4, 4, urbanPark, 37_100),
    ...two('fg.villa.garden-porch', 'villa', 2, 2, gardenPorch, 37_200),
    ...par('fg.pool.community', 'pool', 3, 4, communityPool, 37_300),
  ];
}

export { glassRail, slatScreen, stoneWall, slimPergola, lounge, boundaryWall, skylight, solarPanels, driveway, concrete, stone, walnut, LUX, hedge };
