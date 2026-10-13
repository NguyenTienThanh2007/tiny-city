// Luxury Minimalist commercial and public buildings, Visual World 3.1: architectural concrete office (4×4),
// boutique retail frontage (6×5), glass pavilion clubhouse (3×3), geometric pool (3×4) and community plaza (4×4).
// Malls and pools are parametric in width W (frontage along X, street at +Z) and depth D like the classic bakes.
import * as THREE from 'three';
import { box, plate, rng, mat, path } from '../lib/kit.js';
import { signOn, car, CAR_COLORS, parkingBay } from '../lib/props.js';
import { LUX, metal, bronze, ivoryMat, plasterMat, concrete, stone, walnut, slab, roofDeck, glassWall, framedWindow, slats, slatScreen, fins, stoneWall,
  glassRail, slimPergola, grass, shrubBall, multiStemTree, columnTree, planterBox, steppingStones, pool, lounge, loungers, bollardLight, lightLine,
  boundaryWall, pivotDoor, skylight, solarPanels, roofGarden, deck, terrace, diningSet } from '../lib/modern.js';

const LAWN = 0x8db276;

// ARCHITECTURAL CONCRETE OFFICE: deep concrete frames over recessed glass, garden court at the entrance.
function concreteOffice(group, random) {
  plate(group, 4, 4, LAWN);
  terrace(group, 0.08, 0.08, 3.84, 3.84, 0, { color: 0xe3dacb });
  const x0 = 0.5, x1 = 3.3, z0 = 0.4, z1 = 2.9, F = 0.44, floors = 7;
  box(group, x0 + 0.08, 0, z0 + 0.08, x1 - x0 - 0.16, F * floors, z1 - z0 - 0.16, mat(0x2c363c, { rough: 0.9 }));
  for (let f = 0; f < floors; f += 1) {
    const y = f * F;
    glassWall(group, 'south', z1 - 0.08, x0 + 0.1, y + 0.03, x1 - x0 - 0.2, F - 0.06, { bay: 0.2, lit: f === 0 ? true : (i) => ((i * 3 + f * 5) % 7) > 2 });
    glassWall(group, 'east', x1 - 0.08, z0 + 0.1, y + 0.03, z1 - z0 - 0.2, F - 0.06, { bay: 0.2, lit: f === 0 ? true : (i) => ((i * 5 + f * 3) % 6) > 1 });
    // Deep horizontal concrete band at every floor.
    box(group, x0, y + F - 0.05, z0, x1 - x0, 0.05, z1 - z0, concrete(0xd7d1c5));
  }
  // Deep vertical concrete frames (the signature): a grid of thick piers standing proud of the glass.
  for (let i = 0; i <= 7; i += 1) box(group, x0 + (x1 - x0 - 0.07) * i / 7, 0, z1 - 0.1, 0.07, F * floors, 0.16, concrete(0xd7d1c5));
  for (let i = 0; i <= 6; i += 1) box(group, x1 - 0.1, 0, z0 + (z1 - z0 - 0.07) * i / 6, 0.16, F * floors, 0.07, concrete(0xd7d1c5));
  slab(group, x0 - 0.08, z0 - 0.08, x1 + 0.12, z1 + 0.12, F * floors, { t: 0.08, color: 0xdcd6ca, material: concrete(0xdcd6ca) });
  roofGarden(group, x0 + 0.1, z0 + 0.1, x1 - 1.1, z1 - 0.2, F * floors + 0.08, random);
  solarPanels(group, x1 - 1.0, z0 + 0.2, 4, 6, F * floors + 0.08);
  // Lobby: a deep concrete portal, bronze doors, lit soffit.
  box(group, 1.5, F * 1.5, z1 - 0.1, 0.9, 0.08, 0.5, concrete(0xd7d1c5));
  lightLine(group, 1.55, F * 1.5 - 0.008, z1 + 0.36, 0.8, 0.008, 0.012);
  pivotDoor(group, 'south', z1 + 0.06, 1.8, 0.3, 0.4, { color: LUX.bronze });
  signOn(group, 'south', z1 + 0.06, 1.55, F * 1.5 + 0.1, 0.8, 0.12, 'ATELIER', { bg: '#3a3f43', fg: '#e8d7b0', font: '600 64px Georgia, serif' });
  // Garden court: lawn panels, multi-stem trees, a long stone bench, water rill.
  box(group, 0.2, 0, 3.08, 1.2, 0.01, 0.62, mat(0x92b67c, { rough: 1, tex: 'grass' }));
  box(group, 2.6, 0, 3.08, 1.1, 0.01, 0.62, mat(0x92b67c, { rough: 1, tex: 'grass' }));
  pool(group, 1.55, 3.2, 0.9, 0.12, { water: 0x4ea5b4 });
  for (const [x, z] of [[0.5, 3.4], [1.1, 3.3], [2.9, 3.4], [3.5, 3.3], [3.6, 1.0], [3.6, 2.0]]) multiStemTree(group, x, z, random, { scale: 1.3, leaves: 0x7f9c5f });
  for (let i = 0; i < 8; i += 1) grass(group, 0.3 + i * 0.13, 3.6, random);
  box(group, 2.65, 0, 3.15, 0.9, 0.05, 0.1, stone(LUX.sandstone));
}

// BOUTIQUE RETAIL FRONTAGE: tall glass boutiques with bronze frames and individual entrances along a stone arcade.
function boutiqueFrontage(group, random, W, D) {
  plate(group, W, D, LAWN);
  terrace(group, 0.08, D - 1.25, W - 0.16, 1.15, 0, { color: 0xe8dfcf });
  const bx0 = 0.2, bx1 = W - 0.2, bz0 = 0.3, bz1 = D - 1.4, H = 1.05;
  box(group, bx0, 0, bz0, bx1 - bx0, H, bz1 - bz0, plasterMat(LUX.warmWhite));
  // Stone arcade along the front: thin roof plate on slender stone piers.
  const shops = Math.max(3, Math.round((bx1 - bx0) / 0.95));
  const names = ['MAISON', 'ATELIER', 'NOIR', 'OLIVE', 'LUMEN', 'TERRA'];
  for (let i = 0; i < shops; i += 1) {
    const u = bx0 + (bx1 - bx0) * i / shops, w = (bx1 - bx0) / shops;
    glassWall(group, 'south', bz1, u + 0.06, 0.02, w - 0.12, 0.62, { bay: 0.2, frame: LUX.bronze, lit: true });
    box(group, u + 0.04, 0.64, bz1, w - 0.08, 0.03, 0.03, bronze());
    signOn(group, 'south', bz1 + 0.01, u + w * 0.2, 0.7, w * 0.6, 0.1, names[i % names.length], { bg: '#33383b', fg: '#ecd9ae', font: '600 60px Georgia, serif', frame: 0xb08d57 });
    glassWall(group, 'south', bz1, u + 0.08, 0.84, w - 0.16, 0.16, { bay: 0.24, frame: LUX.charcoal });
  }
  for (let i = 0; i <= shops; i += 1) stoneWall(group, bx0 + (bx1 - bx0) * i / shops - 0.03, bz1, 0.06, 0.66, 0.34, { color: LUX.stone });
  slab(group, bx0 - 0.04, bz1, bx1 + 0.04, bz1 + 0.36, 0.66, { t: 0.04, color: LUX.ivory });
  lightLine(group, bx0 + 0.04, 0.652, bz1 + 0.3, bx1 - bx0 - 0.08, 0.008, 0.012);
  glassWall(group, 'east', bx1, bz0 + 0.1, 0.02, bz1 - bz0 - 0.2, 0.62, { bay: 0.22, frame: LUX.bronze, lit: true });
  slab(group, bx0 - 0.04, bz0 - 0.04, bx1 + 0.04, bz1 + 0.04, H, { t: 0.05, color: LUX.ivory });
  roofDeck(group, bx0, bz0, bx1, bz1, H + 0.05);
  for (let x = bx0 + 0.4; x < bx1 - 0.6; x += 1.1) skylight(group, x, bz0 + 0.3, 0.6, 0.3, H + 0.065);
  // Glazed atrium rising through the roof over the main entrance: bronze fins, lit name band.
  const mid = (bx0 + bx1) / 2, ax0 = mid - 0.55, ax1 = mid + 0.55, az0 = bz1 - 0.9, AH = 1.7;
  box(group, ax0, H, az0, ax1 - ax0, AH - H - 0.08, bz1 - az0, mat(0x2c373d, { rough: 0.9 }));
  glassWall(group, 'south', bz1, ax0, H + 0.02, ax1 - ax0, AH - H - 0.12, { bay: 0.16, frame: LUX.bronze, lit: true });
  glassWall(group, 'east', ax1, az0, H + 0.02, bz1 - az0, AH - H - 0.12, { bay: 0.18, frame: LUX.bronze, lit: true });
  fins(group, 'south', bz1, ax0, H, ax1 - ax0, AH - H - 0.1, { count: 9, depth: 0.06, material: bronze() });
  slab(group, ax0 - 0.06, az0 - 0.06, ax1 + 0.06, bz1 + 0.08, AH - 0.08, { t: 0.08, color: LUX.ivory });
  signOn(group, 'south', bz1 + 0.06, ax0 + 0.15, AH - 0.2, ax1 - ax0 - 0.3, 0.1, 'THE ARCADE', { bg: '#33383b', fg: '#ecd9ae', font: '600 54px Georgia, serif', frame: 0xb08d57 });
  roofGarden(group, bx0 + 0.15, bz0 + 0.7, ax0 - 0.2, bz1 - 0.15, H + 0.065, random);
  // Promenade: planters with multi-stem trees, benches, bollards and a few parked cars at the side.
  for (let x = 0.6; x < W - 0.4; x += 1.0) { planterBox(group, x - 0.2, D - 0.75, 0.4, 0.3, random, { plants: 'mix' }); multiStemTree(group, x, D - 0.6, random, { scale: 1.1, leaves: 0x7f9c5f }); }
  for (let x = 0.4; x < W - 0.2; x += 0.6) bollardLight(group, x, D - 0.1);
  for (let x = 1.0; x < W - 0.6; x += 1.0) box(group, x, 0, D - 1.08, 0.3, 0.05, 0.08, stone(LUX.sandstone));
}

// MINIMALIST GLASS PAVILION CLUBHOUSE: a glass box under a thin roof plate beside a reflecting pool and lounge terrace.
function glassPavilionClub(group, random) {
  plate(group, 3, 3, LAWN);
  terrace(group, 0.2, 0.3, 2.6, 2.0, 0, { color: 0xe9e1d2 });
  const x0 = 0.4, x1 = 1.9, z0 = 0.5, z1 = 1.5, H = 0.64;
  stoneWall(group, x0, z0, 0.3, H, z1 - z0, { color: LUX.stone });
  box(group, x0 + 0.3, 0.012, z0, x1 - x0 - 0.3, H - 0.012, z1 - z0, mat(0x2e3a40, { rough: 0.9 }));
  glassWall(group, 'south', z1, x0 + 0.3, 0.012, x1 - x0 - 0.3, H - 0.02, { bay: 0.2, lit: true });
  glassWall(group, 'east', x1, z0, 0.012, z1 - z0, H - 0.02, { bay: 0.2, lit: true });
  slab(group, x0 - 0.2, z0 - 0.2, x1 + 0.5, z1 + 0.3, H, { t: 0.055, color: LUX.ivory });
  roofDeck(group, x0 - 0.16, z0 - 0.16, x1 + 0.46, z1 + 0.26, H + 0.055);
  for (const [x, z] of [[x1 + 0.4, z0 - 0.1], [x1 + 0.4, z1 + 0.2]]) box(group, x, 0, z, 0.025, H, 0.025, metal());
  lightLine(group, x0, H - 0.012, z1 + 0.26, x1 - x0 + 0.4, 0.008, 0.012);
  signOn(group, 'south', z1 + 0.3, x0 + 0.05, H + 0.005, 0.7, 0.05, 'THE PAVILION', { bg: '#f4efe6', fg: '#3a3f43', font: '600 44px Georgia, serif', glow: true });
  // Reflecting pool wrapping the terrace corner, lounge seating under the overhang, fire table.
  pool(group, 0.4, 1.95, 2.0, 0.35, { water: 0x4fa9b6 });
  pool(group, 2.3, 0.6, 0.35, 1.7, { water: 0x4fa9b6 });
  lounge(group, x1 + 0.08, z0 + 0.1, { axis: 'z' });
  lounge(group, x1 + 0.08, z1 - 0.3, { axis: 'z' });
  diningSet(group, 0.6, 1.6);
  for (const [x, z] of [[0.2, 2.6], [2.7, 2.6], [2.75, 0.3]]) multiStemTree(group, x, z, random, { scale: 1.2, leaves: 0x7d9a5e });
  for (let i = 0; i < 8; i += 1) grass(group, 0.6 + i * 0.22, 2.6, random);
  for (let i = 0; i < 5; i += 1) columnTree(group, 0.15 + i * 0.25, 0.15);
  for (const x of [0.6, 1.4, 2.2]) bollardLight(group, x, 2.88);
}

// LUXURY GEOMETRIC POOL: interlocking rectangular pools in pale stone with cabanas and a sunken lounge.
function geometricPool(group, random, W, D) {
  plate(group, W, D, LAWN);
  terrace(group, 0.12, 0.12, W - 0.24, D - 0.24, 0, { color: 0xeee6d6 });
  const long = W >= D;
  // Two interlocking pools and a shallow wading terrace.
  if (long) { pool(group, 0.4, 0.6, W - 1.3, 0.9, { water: 0x46b0c2 }); pool(group, W - 1.4, 1.2, 0.9, D - 1.8, { water: 0x46b0c2 }); }
  else { pool(group, 0.6, 0.4, 0.9, D - 1.3, { water: 0x46b0c2 }); pool(group, 1.2, D - 1.4, W - 1.8, 0.9, { water: 0x46b0c2 }); }
  // Cabanas: slim timber frames with pale canopies along the back.
  for (let i = 0; i < 3; i += 1) {
    const cx = long ? 0.4 + i * 0.6 : 0.2, cz = long ? 0.18 : 0.4 + i * 0.6;
    slimPergola(group, cx, cz, 0.4, 0.3, 0.26, { beams: 7, beamColor: LUX.oak });
    box(group, cx, 0.3, cz, 0.4, 0.015, 0.3, mat(0xf3eee3, { rough: 0.9, tex: 'fabric' }));
    loungers(group, cx + 0.08, cz + 0.06, 2, { axis: 'z' });
  }
  // Sunken lounge with a fire table, loungers along the long pool edge.
  box(group, long ? 0.5 : W - 1.0, 0, long ? D - 0.9 : 0.5, 0.6, 0.012, 0.5, mat(0xd8cdb8, { rough: 0.9 }));
  lounge(group, long ? 0.55 : W - 0.95, long ? D - 0.85 : 0.55);
  loungers(group, long ? 0.6 : 1.6, long ? 1.58 : 0.6, 5, { axis: long ? 'z' : 'x' });
  // Pool house: a small stone-and-glass changing pavilion.
  const px = W - 1.0, pz = 0.2;
  stoneWall(group, px, pz, 0.8, 0.36, 0.5, { color: LUX.stone });
  glassWall(group, 'south', pz + 0.5, px + 0.1, 0.02, 0.6, 0.3, { bay: 0.2, lit: true });
  slab(group, px - 0.08, pz - 0.06, px + 0.88, pz + 0.66, 0.36, { t: 0.04 });
  for (let x = 0.3; x < W - 0.2; x += 0.4) columnTree(group, x, D - 0.1, { scale: 0.9 });
  for (let z = 0.4; z < D - 0.3; z += 0.4) grass(group, W - 0.15, z, random);
}

// PREMIUM COMMUNITY PLAZA: a paved plaza with a water table, sculpted lawns and a timber pergola.
function communityPlaza(group, random) {
  plate(group, 4, 4, LAWN);
  terrace(group, 0.1, 0.1, 3.8, 3.8, 0, { color: 0xebe2d1 });
  // Sculpted lawn terraces with stone edges.
  for (const [x, z, w, d, h] of [[0.3, 0.3, 1.3, 1.1, 0.06], [2.4, 0.3, 1.3, 1.6, 0.04], [0.3, 2.3, 1.1, 1.3, 0.05]]) {
    box(group, x, 0, z, w, h, d, stone(LUX.sandstone));
    box(group, x + 0.04, h, z + 0.04, w - 0.08, 0.01, d - 0.08, mat(0x8fb377, { rough: 1, tex: 'grass' }));
    const lawn = new THREE.Group(); lawn.position.y = h + 0.01; group.add(lawn);
    multiStemTree(lawn, x + w * 0.5, z + d * 0.5, random, { scale: 1.4, leaves: 0x7d9a5e });
    for (let i = 0; i < 4; i += 1) grass(lawn, x + 0.12 + i * (w - 0.24) / 3, z + d - 0.12, random);
  }
  // Water table in the centre with a low stone rim.
  pool(group, 1.65, 1.5, 1.1, 0.7, { water: 0x4ea8b6 });
  // Timber pergola over a seating terrace.
  slimPergola(group, 1.7, 2.5, 1.6, 0.9, 0.32, { beams: 14, beamColor: LUX.oak });
  for (let i = 0; i < 3; i += 1) box(group, 1.85 + i * 0.5, 0, 2.95, 0.36, 0.05, 0.1, mat(LUX.oak, { rough: 0.7 }));
  diningSet(group, 2.0, 2.65); diningSet(group, 2.7, 2.65);
  // Avenue of column trees along the street edge, bollards, sculpture.
  for (let x = 0.4; x < 3.8; x += 0.5) columnTree(group, x, 3.8, { scale: 1.1 });
  box(group, 1.0, 0, 1.6, 0.14, 0.24, 0.14, bronze());
  for (const x of [1.6, 2.3, 3.0]) bollardLight(group, x, 1.3);
  path(group, 1.45, 0.1, 0.2, 1.3, 0xe2d6c0);
}

export function lmCivicAssets() {
  const sym = (slug, kind, w, d, build, seed) => ['S', 'E'].map((front) => ({ id: `lm.${kind}.${slug}.${front}`, model: `lm.${kind}.${slug}`, kind, variant: 0, front, footprint: { w, d },
    build: (g) => { build(g, rng(seed)); return g; } }));
  const par = (slug, kind, w, d, build, seed) => [
    { id: `lm.${kind}.${slug}.S`, model: `lm.${kind}.${slug}`, kind, variant: 0, front: 'S', footprint: { w, d }, build: (g) => { build(g, rng(seed), w, d); return g; } },
    { id: `lm.${kind}.${slug}.E`, model: `lm.${kind}.${slug}`, kind, variant: 0, front: 'E', footprint: { w, d }, build: (g) => { build(g, rng(seed + 1), d, w); return g; } },
  ];
  return [
    ...sym('architectural-concrete', 'office', 4, 4, concreteOffice, 35_000),
    ...par('boutique-frontage', 'mall', 6, 5, boutiqueFrontage, 35_100),
    ...sym('glass-pavilion', 'clubhouse', 3, 3, glassPavilionClub, 35_200),
    ...par('geometric', 'pool', 3, 4, geometricPool, 35_300),
    { id: 'lm.park.community-plaza.S', model: 'lm.park.community-plaza', kind: 'park', variant: 0, front: 'S', footprint: { w: 4, d: 4 }, build: (g) => { communityPlaza(g, rng(35_400)); return g; } },
  ];
}

export { car, CAR_COLORS, parkingBay, slats, slatScreen, fins, framedWindow, ivoryMat, walnut, steppingStones, boundaryWall, glassRail, shrubBall, deck };
