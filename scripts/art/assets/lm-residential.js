// Luxury Minimalist duplexes (3×2), townhouses (2×3) and apartments (4×4), Visual World 3.1. Duplexes and
// townhouses are parametric in frontage L (along X, street at +Z) and depth D, like the classic bakes: south lots
// build L × D, east lots build D × L and the harness mirrors them across the diagonal so the footprint holds.
import * as THREE from 'three';
import { box, plate, rng, mat, path, palm, bananaPlant } from '../lib/kit.js';
import { LUX, metal, bronze, ivoryMat, plasterMat, concrete, stone, walnut, slab, roofDeck, glassWall, framedWindow, slats, slatScreen, fins, stoneWall,
  glassRail, slimPergola, grass, shrubBall, multiStemTree, columnTree, planterBox, steppingStones, pool, lounge, loungers, bollardLight, lightLine,
  driveway, boundaryWall, pivotDoor, skylight, solarPanels, roofGarden, deck, terrace, diningSet } from '../lib/modern.js';
import { car } from '../lib/props.js';

const LAWN = 0x8db276;
const flip = (x0, x1, mirrored, u, w) => (mirrored ? x1 - (u - x0) - w : u);

// ─── Duplexes ────────────────────────────────────────────────────────────────────────────────────────────────

/** Front garden for one duplex unit: path to its door, grasses, a shrub ball and a bollard. */
function unitGarden(group, random, x0, x1, front, depth, doorU, mirrored) {
  path(group, doorU, front + 0.04, 0.16, depth - front - 0.06, 0xe6dccb);
  const bed = mirrored ? [x0 + 0.06, doorU - 0.04] : [doorU + 0.2, x1 - 0.06];
  for (let x = bed[0]; x < bed[1] - 0.04; x += 0.1) grass(group, x + 0.03, depth - 0.18 - (random() * 0.12), random);
  shrubBall(group, mirrored ? x1 - 0.1 : x0 + 0.1, front + 0.14, 0.045);
  bollardLight(group, doorU + (mirrored ? -0.04 : 0.2), depth - 0.1);
}

// 1. TWIN GLASS DUPLEX: mirrored glass fronts under one roof slab, a stone party fin between them.
function twinGlass(group, random, L, D) {
  plate(group, L, D, LAWN);
  const front = D - 0.56, back = Math.max(0.18, front - 1.0), H = 0.82, half = L / 2;
  box(group, 0.16, 0, back, L - 0.32, H, front - back, plasterMat(LUX.warmWhite));
  for (const mirrored of [false, true]) {
    const x0 = mirrored ? half : 0.16, x1 = mirrored ? L - 0.16 : half;
    const glassU = flip(x0, x1, mirrored, x0 + 0.26, x1 - x0 - 0.32);
    glassWall(group, 'south', front, glassU, 0.02, x1 - x0 - 0.32, H - 0.06, { bay: 0.18, transom: true, lit: (i) => (i + (mirrored ? 1 : 0)) % 3 !== 0 });
    const doorU = flip(x0, x1, mirrored, x0 + 0.06, 0.15);
    pivotDoor(group, 'south', front, doorU, 0.15, 0.34, { color: LUX.walnut });
    box(group, doorU - 0.03, 0.4, front, 0.21, 0.02, 0.14, metal());
    lightLine(group, doorU, 0.392, front + 0.12, 0.15, 0.006, 0.012);
    unitGarden(group, random, x0, x1, front, D, doorU, mirrored);
  }
  // Upper-floor slab edge expressed across both glass fronts.
  box(group, 0.14, 0.4, front, L - 0.28, 0.035, 0.05, mat(LUX.ivory, { rough: 0.6 }));
  glassWall(group, 'east', L - 0.16, back + 0.12, 0.42, front - back - 0.24, 0.32, { bay: 0.22 });
  stoneWall(group, half - 0.04, back - 0.02, 0.08, H + 0.06, front - back + 0.24, { color: LUX.stone });
  slab(group, 0.08, back - 0.08, L - 0.08, front + 0.14, H, { t: 0.05, color: LUX.ivory });
  roofDeck(group, 0.12, back - 0.04, L - 0.12, front + 0.1, H + 0.05);
  for (const x of [0.4, L - 0.7]) skylight(group, x, back + 0.2, 0.3, 0.18, H + 0.065);
  boundaryWall(group, 0.04, D - 0.06, L - 0.08, 'x', { h: 0.05 });
  for (let i = 0; i < Math.round(L * 1.5); i += 1) columnTree(group, 0.14 + i * ((L - 0.28) / Math.max(1, Math.round(L * 1.5) - 1)), 0.08, { scale: 0.9 });
}

// 2. ASYMMETRIC CONCRETE DUPLEX: two homes of different heights; one carries a cantilevered timber box.
function asymmetricConcrete(group, random, L, D) {
  plate(group, L, D, LAWN);
  const front = D - 0.56, back = Math.max(0.18, front - 0.96), half = L / 2;
  // West home: tall, two full storeys of board-formed concrete with deep framed windows.
  box(group, 0.16, 0, back, half - 0.16, 0.86, front - back, concrete(0xdad4c8));
  framedWindow(group, 'south', front, 0.24, 0.48, half - 0.42, 0.26, { surround: LUX.bronze, depth: 0.05, lit: true, material: bronze() });
  glassWall(group, 'south', front, 0.24 + (half - 0.42) * 0.42, 0.02, (half - 0.42) * 0.58, 0.34, { bay: 0.18 });
  pivotDoor(group, 'south', front, 0.22, 0.14, 0.34, { color: LUX.walnut });
  roofDeck(group, 0.16, back, half, front, 0.86, { color: 0xbcb5a8, edge: 0xdad4c8 });
  // East home: one storey with a walnut-clad box cantilevered forward on top.
  box(group, half, 0, back, half - 0.16, 0.42, front - back - 0.12, concrete(0xe2ddd3));
  glassWall(group, 'south', front - 0.12, half + 0.08, 0.02, half - 0.32, 0.36, { bay: 0.2, lit: (i) => i !== 0 });
  box(group, half - 0.02, 0.42, back + 0.1, half - 0.06, 0.36, front - back + 0.08, walnut(0x7e5a3c));
  glassWall(group, 'south', front + 0.08, half + 0.08, 0.5, half - 0.3, 0.2, { bay: 0.24, frame: LUX.charcoal, lit: true });
  glassWall(group, 'east', L - 0.08, back + 0.2, 0.5, front - back - 0.3, 0.2, { bay: 0.24 });
  lightLine(group, half + 0.02, 0.412, front + 0.04, half - 0.12, 0.006, 0.012);
  roofDeck(group, half - 0.02, back + 0.1, L - 0.08, front + 0.08, 0.78, { color: 0xc9c2b4, edge: 0x6b4a33 });
  pivotDoor(group, 'south', front - 0.12, L - 0.36, 0.14, 0.34, { color: LUX.charcoal });
  // Gardens: gravel and a sculptural tree west, drive and grasses east.
  box(group, 0.1, 0, front + 0.06, half - 0.2, 0.008, D - front - 0.12, mat(0xd9d2c4, { rough: 1, tex: 'paving', texScale: 0.3 }));
  multiStemTree(group, 0.32, D - 0.3, random, { scale: 1.05, leaves: 0x86a066 });
  path(group, 0.24, front + 0.02, 0.14, D - front - 0.04, 0xe6dccb);
  driveway(group, half + 0.12, front - 0.04, half - 0.36, D - front + 0.02, { joints: 2 });
  for (let i = 0; i < 4; i += 1) grass(group, L - 0.14, front + 0.1 + i * ((D - front - 0.2) / 3), random);
  bollardLight(group, 0.2, D - 0.1); bollardLight(group, L - 0.3, D - 0.1);
  for (let i = 0; i < Math.round(L * 1.4); i += 1) shrubBall(group, 0.14 + i * 0.22, 0.1, 0.05);
}

// 3. COURTYARD DUPLEX: twin homes, each opening through full glass onto its own walled garden court.
function courtyardDuplex(group, random, L, D) {
  plate(group, L, D, LAWN);
  const back = 0.16, wing = Math.min(0.62, D * 0.32), H = 0.6, half = L / 2;
  // Low homes across the back, ivory render, flat roofs with thin slabs; tall glass onto each court.
  box(group, 0.12, 0, back, L - 0.24, H, wing, plasterMat(LUX.warmWhite));
  slab(group, 0.06, back - 0.06, L - 0.06, back + wing + 0.12, H, { t: 0.045 });
  roofDeck(group, 0.1, back - 0.02, L - 0.1, back + wing + 0.08, H + 0.045);
  roofGarden(group, 0.16, back + 0.04, half - 0.12, back + wing - 0.04, H + 0.06, random);
  solarPanels(group, half + 0.1, back + 0.06, 4, 2, H + 0.06);
  glassWall(group, 'east', L - 0.12, back + 0.08, 0.02, wing - 0.16, H - 0.06, { bay: 0.2 });
  for (const mirrored of [false, true]) {
    const x0 = mirrored ? half + 0.04 : 0.12, x1 = mirrored ? L - 0.12 : half - 0.04;
    glassWall(group, 'south', back + wing, x0 + 0.04, 0.02, x1 - x0 - 0.08, H - 0.06, { bay: 0.18, lit: (i) => (i + (mirrored ? 2 : 0)) % 3 !== 1 });
    // Walled court: stone side walls, a timber street screen with a gate, lawn, tree, stepping stones.
    const zc0 = back + wing, zc1 = D - 0.12;
    box(group, x0 + 0.06, 0, zc0 + 0.04, x1 - x0 - 0.12, 0.008, zc1 - zc0 - 0.08, mat(0x92b67c, { rough: 1, tex: 'grass' }));
    const gate = flip(x0, x1, mirrored, x0 + 0.08, 0.2);
    slatScreen(group, mirrored ? x0 : gate + 0.2, zc1, mirrored ? gate - x0 : x1 - gate - 0.2, 0.22, 'x', { color: LUX.walnut });
    box(group, gate, 0, zc1 - 0.01, 0.2, 0.012, 0.06, stone(LUX.sandstone));
    box(group, gate - 0.02, 0, zc1 - 0.02, 0.025, 0.26, 0.05, metal()); box(group, gate + 0.195, 0, zc1 - 0.02, 0.025, 0.26, 0.05, metal());
    box(group, gate - 0.02, 0.26, zc1 - 0.02, 0.24, 0.02, 0.05, metal());
    steppingStones(group, gate + 0.05, zc0 + 0.08, Math.max(2, Math.floor((zc1 - zc0 - 0.12) / 0.14)), 'z', { size: 0.12, gap: 0.03 });
    multiStemTree(group, flip(x0, x1, mirrored, x1 - 0.3, 0), zc0 + (zc1 - zc0) * 0.5, random, { scale: 0.95, leaves: mirrored ? 0x7f9f60 : 0x6f9658 });
    for (let i = 0; i < 3; i += 1) grass(group, flip(x0, x1, mirrored, x1 - 0.16 - i * 0.09, 0), zc1 - 0.12, random, { scale: 0.85 });
    lounge(group, flip(x0, x1, mirrored, x0 + 0.34, 0.2), zc0 + 0.1);
  }
  stoneWall(group, 0.08, back + wing, 0.05, 0.24, D - 0.2 - back - wing, { color: LUX.stone });
  stoneWall(group, half - 0.04, back + wing, 0.08, 0.26, D - 0.2 - back - wing, { color: LUX.stone });
  stoneWall(group, L - 0.13, back + wing, 0.05, 0.24, D - 0.2 - back - wing, { color: LUX.stone });
  for (const x of [0.16, L - 0.2]) bollardLight(group, x, D - 0.05);
}

// 4. URBAN TERRACE DUPLEX: stacked homes in a charcoal frame with vertical fins and planted roof terraces.
function urbanTerrace(group, random, L, D) {
  plate(group, L, D, LAWN);
  const front = D - 0.5, back = Math.max(0.16, front - 0.98), half = L / 2, g = 0.4, u = 0.4;
  box(group, 0.14, 0, back, L - 0.28, g + u, front - back - 0.18, ivoryMat(LUX.ivory));
  for (const mirrored of [false, true]) {
    const x0 = mirrored ? half : 0.14, x1 = mirrored ? L - 0.14 : half;
    glassWall(group, 'south', front - 0.18, x0 + 0.06, 0.02, x1 - x0 - 0.12, g - 0.05, { bay: 0.18, lit: (i) => i % 2 === (mirrored ? 0 : 1) });
    glassWall(group, 'south', front - 0.18, x0 + 0.06, g + 0.04, x1 - x0 - 0.12, u - 0.1, { bay: 0.18, lit: (i) => i !== 1 });
    fins(group, 'south', front - 0.18, x0 + 0.08, g, x1 - x0 - 0.16, u, { count: Math.max(4, Math.round((x1 - x0) * 7)), depth: 0.07, color: LUX.oak, material: walnut(LUX.oak) });
    const doorU = flip(x0, x1, mirrored, x0 + 0.08, 0.14);
    pivotDoor(group, 'south', front - 0.18, doorU, 0.14, 0.32, { color: LUX.charcoal });
    unitGarden(group, random, x0, x1, front, D, doorU, mirrored);
  }
  // Charcoal frame around the facade: slab bands and end columns.
  const frame = metal(0x34393c);
  for (const y of [0, g - 0.02, g + u - 0.02]) box(group, 0.1, y, front - 0.2, L - 0.2, 0.04, 0.08, frame);
  for (const x of [0.1, half - 0.025, L - 0.15]) box(group, x, 0, front - 0.2, 0.05, g + u + 0.02, 0.08, frame);
  glassWall(group, 'east', L - 0.14, back + 0.12, g + 0.04, front - back - 0.42, u - 0.1, { bay: 0.22 });
  // Roof terraces: decks, glass rails, planters, a slim pergola on each.
  const top = g + u + 0.02;
  deck(group, 0.16, back + 0.02, L - 0.32, front - back - 0.22, top);
  glassRail(group, 0.14, top + 0.014, front - 0.2, L - 0.28, 'x', { h: 0.09 });
  glassRail(group, L - 0.15, top + 0.014, back, front - back - 0.2, 'z', { h: 0.09 });
  box(group, half - 0.02, top, back, 0.04, 0.12, front - back - 0.2, frame);
  const roofTop = new THREE.Group(); roofTop.position.y = top + 0.014; group.add(roofTop);
  for (const mirrored of [false, true]) {
    const x0 = mirrored ? half + 0.04 : 0.2, x1 = mirrored ? L - 0.2 : half - 0.04;
    planterBox(roofTop, x0, front - 0.36, x1 - x0, 0.1, random, { h: 0.06, plants: 'mix' });
    slimPergola(roofTop, flip(x0, x1, mirrored, x0, 0.42), back + 0.08, Math.min(0.42, x1 - x0), 0.36, 0.22, { beams: 8 });
    lounge(roofTop, flip(x0, x1, mirrored, x0 + 0.04, 0.2), back + 0.16);
  }
  boundaryWall(group, 0.04, D - 0.06, L - 0.08, 'x', { h: 0.05 });
}

const DUPLEX = [['twin-glass', twinGlass], ['asymmetric-concrete', asymmetricConcrete], ['courtyard', courtyardDuplex], ['urban-terrace', urbanTerrace]];

// ─── Townhouses ──────────────────────────────────────────────────────────────────────────────────────────────

/** Splits the frontage into units, one per tile (two on south lots, three on east lots). */
const unitsOf = (L) => {
  const n = Math.max(2, Math.round(L));
  return Array.from({ length: n }, (_, i) => ({ i, x0: 0.06 + (i * (L - 0.12)) / n, x1: 0.06 + ((i + 1) * (L - 0.12)) / n }));
};
const STOREY = 0.4;

// 1. VERTICAL MINIMALIST: tall ivory houses of alternating height, each with a deep two-storey projecting
// frame (charcoal or bronze) around stacked glazing, stone fins between the units and recessed lit entrances.
function verticalMinimalist(group, random, L, D) {
  plate(group, L, D, LAWN);
  const front = D - 0.46, back = Math.max(0.1, front - 1.46);
  const units = unitsOf(L);
  units.forEach(({ i, x0, x1 }) => {
    const w = x1 - x0, tall = i % 2 === 0, h = 3 * STOREY + (tall ? 0.22 : 0);
    box(group, x0, 0, back, w, h, front - back, plasterMat(tall ? LUX.warmWhite : 0xefe8dc));
    box(group, x0, 0, front - 0.01, w, 0.06, 0.04, stone(LUX.stone));
    // Two-storey projecting frame: thick surround standing proud of the facade, glazing recessed inside it.
    const fx = x0 + w * 0.12, fw = w * 0.62, fy = STOREY + 0.04, fh = 2 * STOREY - 0.1, depth = 0.13;
    const fm = tall ? metal(0x34393c) : bronze();
    box(group, fx - 0.03, fy - 0.03, front, fw + 0.06, 0.03, depth, fm); box(group, fx - 0.03, fy + fh, front, fw + 0.06, 0.03, depth, fm);
    box(group, fx - 0.03, fy, front, 0.03, fh, depth, fm); box(group, fx + fw, fy, front, 0.03, fh, depth, fm);
    glassWall(group, 'south', front, fx, fy, fw, fh, { bay: 0.14, transom: true, lit: (k) => (k + i) % 2 === 0 });
    box(group, fx, fy + fh * 0.48, front, fw, 0.02, depth * 0.8, mat(LUX.ivory, { rough: 0.6 }));
    // Small high window beside the frame and a recessed, lit entrance below it.
    framedWindow(group, 'south', front, x0 + w * 0.8, STOREY + 0.18, w * 0.1, 0.3, { surround: LUX.charcoal, depth: 0.03 });
    box(group, x0 + w * 0.12, 0, front - 0.07, w * 0.3, 0.32, 0.07, mat(0x2f3437, { rough: 0.8 }));
    pivotDoor(group, 'south', front - 0.07, x0 + w * 0.15, w * 0.24, 0.3, { color: LUX.walnut });
    lightLine(group, x0 + w * 0.13, 0.318, front - 0.005, w * 0.28, 0.006, 0.01);
    glassWall(group, 'south', front, x0 + w * 0.48, 0.04, w * 0.44, STOREY - 0.1, { bay: 0.12, lit: true });
    roofDeck(group, x0, back, x1, front, h, { edge: tall ? LUX.warmWhite : 0xefe8dc, h: 0.05 });
    if (tall) skylight(group, x0 + w * 0.3, back + 0.3, w * 0.4, 0.2, h + 0.015);
    planterBox(group, x0 + w * 0.5, front + 0.06, w * 0.42, 0.1, random, { h: 0.05 });
    bollardLight(group, x0 + w * 0.3, D - 0.08);
  });
  // Stone fins between the units, standing proud of the facades.
  for (let k = 1; k < units.length; k += 1) stoneWall(group, units[k].x0 - 0.025, front - 0.04, 0.05, 3 * STOREY + 0.1, 0.14, { color: LUX.stone });
  const last = units.at(-1);
  for (let f = 1; f < 3; f += 1) framedWindow(group, 'east', last.x1, back + 0.3, f * STOREY + 0.06, 0.3, STOREY - 0.14, { surround: LUX.charcoal, depth: 0.05 });
  terrace(group, 0.02, front + 0.02, L - 0.04, 0.06, 0, { color: 0xe4dbc9 });
}

// 2. URBAN GLASS: glass fronts in slim charcoal frames, bronze entrance canopies.
function urbanGlass(group, random, L, D) {
  plate(group, L, D, LAWN);
  const front = D - 0.42, back = Math.max(0.1, front - 1.5);
  unitsOf(L).forEach(({ i, x0, x1 }) => {
    const h = 3 * STOREY + (i === 1 ? 0.12 : 0), w = x1 - x0;
    box(group, x0, 0, back, w, h, front - back, plasterMat(i % 2 ? 0xe9e5dc : 0xf2eee6));
    glassWall(group, 'south', front, x0 + 0.05, STOREY + 0.02, w - 0.1, h - STOREY - 0.06, { bay: 0.14, transom: false, lit: (k) => (k + i) % 2 === 0 });
    for (let f = 1; f < 3; f += 1) box(group, x0 + 0.04, f * STOREY + (f === 1 ? 0 : 0.0), front, w - 0.08, 0.02, 0.05, metal());
    box(group, x0, h - 0.04, back, w, 0.04, front - back + 0.04, metal(0x31363a));
    glassWall(group, 'south', front, x0 + w * 0.42, 0.04, w * 0.5, STOREY - 0.1, { bay: 0.14, lit: true });
    pivotDoor(group, 'south', front, x0 + w * 0.1, w * 0.24, 0.32, { color: LUX.bronze });
    box(group, x0 + w * 0.04, STOREY - 0.04, front, w * 0.38, 0.018, 0.16, bronze());
    lightLine(group, x0 + w * 0.08, STOREY - 0.046, front + 0.14, w * 0.3, 0.006, 0.01);
    roofDeck(group, x0, back, x1, front + 0.04, h, { edge: 0x31363a });
    bollardLight(group, x0 + w * 0.75, D - 0.08);
    columnTree(group, x0 + w * 0.82, front + 0.18, { scale: 0.85 });
  });
  const last = unitsOf(L).at(-1);
  glassWall(group, 'east', last.x1, back + 0.2, STOREY + 0.04, front - back - 0.4, 2 * STOREY - 0.1, { bay: 0.2 });
  terrace(group, 0.02, front + 0.02, L - 0.04, D - front - 0.04, 0, { color: 0xe4dbc9 });
}

// 3. ROOFTOP TERRACE: stepped houses with roof gardens, glass balustrades and pergolas on top.
function rooftopTerrace(group, random, L, D) {
  plate(group, L, D, LAWN);
  const front = D - 0.46, back = Math.max(0.1, front - 1.46);
  unitsOf(L).forEach(({ i, x0, x1 }) => {
    const w = x1 - x0, h = 2 * STOREY + 0.06;
    box(group, x0, 0, back, w, h, front - back, plasterMat(LUX.warmWhite));
    // A set-back top storey leaves a terrace at the front.
    box(group, x0 + 0.03, h, back, w - 0.06, STOREY - 0.04, (front - back) * 0.5, walnut(i % 2 ? 0x8a6544 : LUX.walnut));
    glassWall(group, 'south', back + (front - back) * 0.5, x0 + 0.08, h + 0.03, w - 0.16, STOREY - 0.12, { bay: 0.16, lit: (k) => (k + i) % 2 === 1 });
    roofGarden(group, x0 + 0.05, back + 0.02, x1 - 0.05, back + (front - back) * 0.5 - 0.02, h + STOREY - 0.04, random);
    deck(group, x0 + 0.02, back + (front - back) * 0.5, w - 0.04, (front - back) * 0.5, h);
    glassRail(group, x0 + 0.02, h + 0.014, front - 0.02, w - 0.04, 'x', { h: 0.09 });
    const top = new THREE.Group(); top.position.y = h + 0.014; group.add(top);
    slimPergola(top, x0 + 0.08, back + (front - back) * 0.55, w - 0.16, (front - back) * 0.3, 0.24, { beams: 7, axis: 'z' });
    planterBox(top, x0 + 0.08, front - 0.14, w * 0.4, 0.08, random, { h: 0.05, plants: 'mix' });
    glassWall(group, 'south', front, x0 + 0.06, STOREY + 0.04, w - 0.12, STOREY - 0.1, { bay: 0.16, lit: (k) => (k + i) % 3 !== 0 });
    glassWall(group, 'south', front, x0 + w * 0.42, 0.04, w * 0.5, STOREY - 0.1, { bay: 0.16, lit: true });
    box(group, x0, STOREY - 0.01, front, w, 0.03, 0.05, mat(LUX.ivory, { rough: 0.6 }));
    pivotDoor(group, 'south', front, x0 + w * 0.1, w * 0.24, 0.32, { color: LUX.walnut });
    bollardLight(group, x0 + w * 0.6, D - 0.08);
  });
  const last = unitsOf(L).at(-1);
  glassRail(group, last.x1 - 0.02, 2 * STOREY + 0.074, back + (front - back) * 0.5, (front - back) * 0.5, 'z', { h: 0.09 });
  glassWall(group, 'east', last.x1, back + 0.24, 0.04, front - back - 0.48, 2 * STOREY - 0.06, { bay: 0.2 });
  for (let x = 0.12; x < L - 0.1; x += 0.24) grass(group, x, D - 0.22, random);
}

// 4. WARM TIMBER: walnut-clad houses with timber screens over the windows and planted window ledges.
function warmTimber(group, random, L, D) {
  plate(group, L, D, LAWN);
  const front = D - 0.42, back = Math.max(0.1, front - 1.5);
  unitsOf(L).forEach(({ i, x0, x1 }) => {
    const w = x1 - x0, h = 3 * STOREY + (i % 2) * 0.06;
    box(group, x0, 0, back, w, h, front - back, walnut(i % 2 ? 0x8d6846 : 0x75502f));
    box(group, x0, 0, front - 0.005, w, STOREY, 0.03, stone(LUX.sandstone));
    for (let f = 1; f < 3; f += 1) {
      framedWindow(group, 'south', front, x0 + w * 0.14, f * STOREY + 0.05, w * 0.72, STOREY - 0.12, { surround: LUX.charcoal, depth: 0.03, lit: random() < 0.75 });
      slats(group, 'south', front + 0.03, x0 + w * 0.5, f * STOREY + 0.03, w * 0.38, STOREY - 0.08, { color: 0xc4996b, out: 0.02, gap: 0.03 });
      planterBox(group, x0 + w * 0.12, front + 0.02, w * 0.36, 0.06, random, { h: 0.035, color: LUX.charcoal });
    }
    const ledge = new THREE.Group(); group.add(ledge);
    glassWall(group, 'south', front + 0.03, x0 + w * 0.42, 0.04, w * 0.48, STOREY - 0.1, { bay: 0.14, lit: true });
    pivotDoor(group, 'south', front + 0.03, x0 + w * 0.1, w * 0.24, 0.32, { color: LUX.charcoal });
    slab(group, x0 - 0.01, back - 0.02, x1 + 0.01, front + 0.06, h, { t: 0.04, color: LUX.ivory, reveal: false });
    roofDeck(group, x0 + 0.01, back, x1 - 0.01, front + 0.04, h + 0.04);
    bollardLight(group, x0 + w * 0.7, D - 0.08);
    multiStemTree(group, x0 + w * 0.78, D - 0.24, random, { scale: 0.8, leaves: 0x7c9b5f });
  });
  const last = unitsOf(L).at(-1);
  for (let f = 1; f < 3; f += 1) framedWindow(group, 'east', last.x1, back + 0.4, f * STOREY + 0.05, 0.4, STOREY - 0.14, { surround: LUX.charcoal });
  terrace(group, 0.02, front + 0.04, L - 0.04, 0.08, 0, { color: 0xe4dbc9 });
}

const TOWNHOUSE = [['vertical-minimalist', verticalMinimalist], ['urban-glass', urbanGlass], ['rooftop-terrace', rooftopTerrace], ['warm-timber', warmTimber]];

// ─── Apartments (4×4) ────────────────────────────────────────────────────────────────────────────────────────

/** Ground plaza for apartment lots: paving, a planted edge and street bollards. */
function plaza(group, random, { color = 0xe6dccb } = {}) {
  plate(group, 4, 4, LAWN);
  terrace(group, 0.08, 0.08, 3.84, 3.84, 0, { color });
  for (let x = 0.3; x < 3.8; x += 0.5) bollardLight(group, x, 3.88);
}

// 1. PREMIUM GLASS RESIDENCE: glass body with ivory slab edges and wraparound balconies.
function premiumGlass(group, random) {
  plaza(group, random);
  const x0 = 0.6, x1 = 3.2, z0 = 0.5, z1 = 3.0, F = 0.42, floors = 7;
  box(group, x0, 0, z0, x1 - x0, F * floors, z1 - z0, mat(0x2b3840, { rough: 0.9 }));
  for (let f = 0; f < floors; f += 1) {
    const y = f * F;
    glassWall(group, 'south', z1, x0, y + 0.04, x1 - x0, F - 0.06, { bay: 0.26, lit: f === 0 ? true : (i) => ((i * 7 + f * 3) % 5) > 1 });
    glassWall(group, 'east', x1, z0, y + 0.04, z1 - z0, F - 0.06, { bay: 0.26, lit: f === 0 ? true : (i) => ((i * 5 + f) % 4) > 0 });
    if (f > 0) {
      // Wraparound balcony slab with glass rail.
      box(group, x0 - 0.06, y - 0.03, z0 - 0.06, x1 - x0 + 0.18, 0.04, z1 - z0 + 0.18, mat(LUX.ivory, { rough: 0.55 }));
      glassRail(group, x0 - 0.06, y + 0.01, z1 + 0.11, x1 - x0 + 0.18, 'x', { h: 0.1 });
      glassRail(group, x1 + 0.11, y + 0.01, z0 - 0.06, z1 - z0 + 0.18, 'z', { h: 0.1 });
    }
  }
  slab(group, x0 - 0.1, z0 - 0.1, x1 + 0.16, z1 + 0.16, F * floors, { t: 0.07, color: LUX.ivory });
  roofDeck(group, x0, z0, x1, z1, F * floors + 0.07);
  box(group, x0 + 0.5, F * floors + 0.07, z0 + 0.4, 0.9, 0.22, 0.7, mat(0xd9d3c8, { rough: 0.7 }));
  solarPanels(group, x0 + 1.5, z0 + 0.3, 6, 3, F * floors + 0.08);
  // Double-height lit lobby with a bronze canopy and the residence name lit in the soffit.
  box(group, 1.4, F - 0.04, z1, 1.0, 0.03, 0.4, bronze());
  lightLine(group, 1.45, F - 0.05, z1 + 0.36, 0.9, 0.008, 0.014);
  pivotDoor(group, 'south', z1, 1.75, 0.3, 0.36, { color: LUX.bronze });
  // Landscape: planters, trees, a water feature and grasses.
  pool(group, 0.3, 3.3, 1.0, 0.3, { water: 0x4fa6b4 });
  for (const [x, z] of [[2.7, 3.4], [3.5, 2.4], [3.5, 1.2], [0.3, 1.0]]) multiStemTree(group, x, z, random, { scale: 1.3, leaves: 0x7d9c5f });
  for (let i = 0; i < 6; i += 1) planterBox(group, 3.42, 0.5 + i * 0.4, 0.3, 0.3, random, { plants: i % 2 ? 'grass' : 'mix' });
  for (let i = 0; i < 8; i += 1) grass(group, 0.3 + i * 0.12, 3.75, random);
}

// 2. GREEN TERRACE APARTMENTS: floors step back south and east, every terrace overflowing with planting.
function greenTerrace(group, random) {
  plaza(group, random, { color: 0xe1d7c5 });
  const floors = 6, F = 0.42;
  for (let f = 0; f < floors; f += 1) {
    const step = f * 0.18, x0 = 0.4, z0 = 0.4, x1 = 3.5 - step, z1 = 3.4 - step, y = f * F;
    box(group, x0, y, z0, x1 - x0, F, z1 - z0, plasterMat(LUX.warmWhite));
    glassWall(group, 'south', z1, x0 + 0.1, y + 0.04, x1 - x0 - 0.2, F - 0.08, { bay: 0.24, lit: (i) => ((i * 3 + f) % 4) !== 0 });
    glassWall(group, 'east', x1, z0 + 0.1, y + 0.04, z1 - z0 - 0.2, F - 0.08, { bay: 0.24, lit: (i) => ((i + f * 2) % 3) !== 0 });
    // Timber soffit edge, terrace deck and continuous planters at the step.
    box(group, x0 - 0.02, y + F - 0.03, z0 - 0.02, x1 - x0 + 0.04, 0.035, z1 - z0 + 0.04, walnut(LUX.oak));
    if (f < floors - 1) {
      const terraceY = y + F;
      deck(group, x1 - 0.18, z0, 0.18, z1 - z0, terraceY);
      deck(group, x0, z1 - 0.18, x1 - x0, 0.18, terraceY);
      const g = new THREE.Group(); g.position.y = terraceY; group.add(g);
      planterBox(g, x0 + 0.02, z1 - 0.1, x1 - x0 - 0.04, 0.08, random, { h: 0.05, plants: 'mix' });
      planterBox(g, x1 - 0.1, z0 + 0.02, 0.08, z1 - z0 - 0.14, random, { h: 0.05, plants: 'mix' });
    }
  }
  const topY = floors * F;
  roofGarden(group, 0.44, 0.44, 3.5 - 5 * 0.18 - 0.04, 3.4 - 5 * 0.18 - 0.04, topY, random);
  slimPergola(group, 1.0, 1.0, 0.8, 0.6, topY + 0.24, { beams: 9 });
  // Garden podium: lawn mounds, trees, path to a glazed lobby.
  pivotDoor(group, 'south', 3.4, 1.6, 0.3, 0.34, { color: LUX.walnut });
  path(group, 1.55, 3.4, 0.4, 0.5, 0xe6dccb);
  for (const [x, z] of [[0.3, 3.6], [3.7, 3.6], [3.7, 1.0], [3.7, 2.2], [1.0, 3.7]]) multiStemTree(group, x, z, random, { scale: 1.35, leaves: 0x6f9658 });
  for (let i = 0; i < 10; i += 1) grass(group, 2.2 + (i % 5) * 0.14, 3.55 + Math.floor(i / 5) * 0.14, random);
}

// 3. MINIMALIST RESIDENTIAL TOWER: a slender ivory tower with recessed loggias and a bronze crown.
function residentialTower(group, random) {
  plaza(group, random, { color: 0xe8dfcf });
  const x0 = 1.0, x1 = 3.0, z0 = 0.8, z1 = 2.8, F = 0.4, floors = 8, base = 0.5;
  stoneWall(group, x0 - 0.1, z0 - 0.1, x1 - x0 + 0.2, base, z1 - z0 + 0.2, { color: LUX.stone, cap: LUX.ivory });
  glassWall(group, 'south', z1 + 0.1, x0 + 0.3, 0.04, x1 - x0 - 0.6, base - 0.1, { bay: 0.2, lit: true });
  glassWall(group, 'east', x1 + 0.1, z0 + 0.3, 0.04, z1 - z0 - 0.6, base - 0.1, { bay: 0.2, lit: true });
  for (let f = 0; f < floors; f += 1) {
    const y = base + f * F;
    box(group, x0, y, z0, x1 - x0, F, z1 - z0, ivoryMat(LUX.ivory));
    // Recessed loggias: dark inset with glass, set into the ivory frame (two per face, alternating).
    for (const [u, w] of [[x0 + 0.14, 0.7], [x0 + 1.12, 0.74]]) {
      box(group, u, y + 0.06, z1 - 0.06, w, F - 0.1, 0.07, mat(0x384046, { rough: 0.8 }));
      glassWall(group, 'south', z1 + 0.01, u + 0.04, y + 0.07, w - 0.08, F - 0.13, { bay: 0.25, lit: (i) => ((i + f) % 3) !== 0 });
      if (f % 2 === 0) glassRail(group, u, y + 0.06, z1 + 0.03, w, 'x', { h: 0.09 });
    }
    for (const [u, w] of [[z0 + 0.14, 0.7], [z0 + 1.12, 0.74]]) {
      box(group, x1 - 0.06, y + 0.06, u, 0.07, F - 0.1, w, mat(0x384046, { rough: 0.8 }));
      glassWall(group, 'east', x1 + 0.01, u + 0.04, y + 0.07, w - 0.08, F - 0.13, { bay: 0.25, lit: (i) => ((i + f * 2) % 3) !== 1 });
    }
  }
  const top = base + floors * F;
  // Bronze crown: a recessed top storey with fins and a thin lid.
  box(group, x0 + 0.12, top, z0 + 0.12, x1 - x0 - 0.24, 0.32, z1 - z0 - 0.24, mat(0x2e3439, { rough: 0.7 }));
  fins(group, 'south', z1 - 0.12, x0 + 0.14, top, x1 - x0 - 0.28, 0.32, { count: 14, depth: 0.05, material: bronze() });
  fins(group, 'east', x1 - 0.12, z0 + 0.14, top, z1 - z0 - 0.28, 0.32, { count: 14, depth: 0.05, material: bronze() });
  slab(group, x0 - 0.04, z0 - 0.04, x1 + 0.04, z1 + 0.04, top + 0.32, { t: 0.05, color: LUX.ivory });
  lightLine(group, x0 + 0.1, top + 0.3, z1 - 0.08, x1 - x0 - 0.2, 0.01, 0.01);
  pivotDoor(group, 'south', z1 + 0.1, 1.85, 0.3, 0.38, { color: LUX.bronze });
  // Plaza: rows of column trees, planters and a reflecting pool by the entrance.
  pool(group, 0.3, 3.2, 1.4, 0.4, { water: 0x4fa6b4 });
  for (let i = 0; i < 6; i += 1) columnTree(group, 3.5, 0.5 + i * 0.5, { scale: 1.2 });
  for (let i = 0; i < 4; i += 1) columnTree(group, 0.5 + i * 0.5, 0.4, { scale: 1.2 });
  for (const x of [2.4, 3.0, 3.6]) planterBox(group, x - 0.15, 3.3, 0.3, 0.3, random, { plants: 'mix' });
  multiStemTree(group, 0.45, 2.0, random, { scale: 1.4, leaves: 0x86a066 });
}

// 4. CONTEMPORARY COURTYARD APARTMENTS: a U-shaped block around a landscaped court with a reflecting pool.
function contemporaryCourtyard(group, random) {
  plaza(group, random, { color: 0xe4dacb });
  const F = 0.42, floors = 5, H = F * floors;
  const wings = [[0.3, 0.3, 3.7, 1.3], [0.3, 1.3, 1.25, 3.6], [2.75, 1.3, 3.7, 3.6]];
  for (const [x0, z0, x1, z1] of wings) {
    box(group, x0, 0, z0, x1 - x0, H, z1 - z0, plasterMat(LUX.warmWhite));
    slab(group, x0 - 0.04, z0 - 0.04, x1 + 0.04, z1 + 0.04, H, { t: 0.05, color: LUX.ivory, reveal: false });
    roofDeck(group, x0, z0, x1, z1, H + 0.05);
  }
  for (let f = 0; f < floors; f += 1) {
    const y = f * F;
    // Street ends of the side wings and the court-facing faces carry the glazing; walnut screens alternate.
    glassWall(group, 'south', 3.6, 0.38, y + 0.05, 0.8, F - 0.1, { bay: 0.2, lit: (i) => ((i + f) % 3) !== 0 });
    glassWall(group, 'south', 3.6, 2.83, y + 0.05, 0.8, F - 0.1, { bay: 0.2, lit: (i) => ((i + f) % 2) === 0 });
    glassWall(group, 'south', 1.3, 1.3, y + 0.05, 1.4, F - 0.1, { bay: 0.23, lit: (i) => ((i * 2 + f) % 3) !== 0 });
    glassWall(group, 'east', 1.25, 1.4, y + 0.05, 2.1, F - 0.1, { bay: 0.23, lit: (i) => ((i + f) % 4) !== 0 });
    glassWall(group, 'east', 3.7, 1.4, y + 0.05, 2.1, F - 0.1, { bay: 0.23, lit: (i) => ((i + 2 * f) % 3) !== 1 });
    glassWall(group, 'east', 3.7, 0.4, y + 0.05, 0.8, F - 0.1, { bay: 0.2 });
    if (f % 2 === 1) {
      slats(group, 'south', 3.6, 0.38, y + 0.04, 0.36, F - 0.08, { color: LUX.walnut, out: 0.03 });
      slats(group, 'east', 1.25, 2.4, y + 0.04, 0.6, F - 0.08, { color: LUX.walnut, out: 0.03 });
    }
    box(group, 1.25, y + F - 0.02, 1.3, 1.5, 0.025, 0.06, mat(LUX.ivory, { rough: 0.6 }));
  }
  // The court: long reflecting pool, lawn, specimen trees, grasses, loungers; entrance gap from the street.
  box(group, 1.3, 0, 1.36, 1.4, 0.008, 2.2, mat(0x92b67c, { rough: 1, tex: 'grass' }));
  pool(group, 1.7, 1.6, 0.6, 1.5, { water: 0x4ea5b4 });
  for (const [x, z] of [[1.45, 1.6], [2.55, 2.4], [1.45, 3.0]]) multiStemTree(group, x, z, random, { scale: 1.25, leaves: 0x7a9b5d });
  for (let i = 0; i < 8; i += 1) grass(group, 1.4 + (i % 2) * 1.2, 1.9 + Math.floor(i / 2) * 0.32, random);
  loungers(group, 2.4, 1.5, 2, { axis: 'z' });
  steppingStones(group, 1.92, 3.12, 4, 'z', { size: 0.14, gap: 0.05 });
  slatScreen(group, 1.3, 3.66, 0.45, 0.28, 'x', { color: LUX.walnut });
  slatScreen(group, 2.25, 3.66, 0.45, 0.28, 'x', { color: LUX.walnut });
  pivotDoor(group, 'south', 3.6, 0.6, 0.28, 0.36, { color: LUX.walnut });
}

const APARTMENT = [['premium-glass', premiumGlass], ['green-terrace', greenTerrace], ['residential-tower', residentialTower], ['contemporary-courtyard', contemporaryCourtyard]];

export function lmResidentialAssets() {
  const duplexes = DUPLEX.flatMap(([slug, build], index) => [
    { id: `lm.duplex.${slug}.S`, model: `lm.duplex.${slug}`, kind: 'duplex', variant: index, front: 'S', footprint: { w: 3, d: 2 }, build: (g) => { build(g, rng(32_000 + index * 97), 3, 2); return g; } },
    { id: `lm.duplex.${slug}.E`, model: `lm.duplex.${slug}`, kind: 'duplex', variant: index, front: 'E', footprint: { w: 3, d: 2 }, build: (g) => { build(g, rng(32_500 + index * 97), 2, 3); return g; } },
  ]);
  const townhouses = TOWNHOUSE.flatMap(([slug, build], index) => [
    { id: `lm.townhouse.${slug}.S`, model: `lm.townhouse.${slug}`, kind: 'townhouse', variant: index, front: 'S', footprint: { w: 2, d: 3 }, build: (g) => { build(g, rng(33_000 + index * 89), 2, 3); return g; } },
    { id: `lm.townhouse.${slug}.E`, model: `lm.townhouse.${slug}`, kind: 'townhouse', variant: index, front: 'E', footprint: { w: 2, d: 3 }, build: (g) => { build(g, rng(33_500 + index * 89), 3, 2); return g; } },
  ]);
  const apartments = APARTMENT.flatMap(([slug, build], index) => ['S', 'E'].map((front) => (
    { id: `lm.apartment.${slug}.${front}`, model: `lm.apartment.${slug}`, kind: 'apartment', variant: index, front, footprint: { w: 4, d: 4 }, build: (g) => { build(g, rng(34_000 + index * 83)); return g; } })));
  return [...duplexes, ...townhouses, ...apartments];
}

export { palm, bananaPlant, car, diningSet, lounge, steppingStones };
