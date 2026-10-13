// Luxury Minimalist villas (2×2), Visual World 3.1: six distinct contemporary homes in ivory render, light
// concrete, natural stone, walnut, charcoal metal and glass. Each has its own massing and silhouette; built facing
// south (+Z, the street) and mirrored by the harness for east-facing lots.
import * as THREE from 'three';
import { box, plate, rng, mat, glass, path, bananaPlant, fanPalm, palm, shrub } from '../lib/kit.js';
import { LUX, metal, bronze, ivoryMat, plasterMat, concrete, stone, walnut, slab, roofDeck, glassWall, framedWindow, slats, slatScreen, fins, stoneWall,
  glassRail, slimPergola, grass, shrubBall, multiStemTree, columnTree, planterBox, steppingStones, pool, lounge, loungers, bollardLight, lightLine,
  sconce, driveway, carport, boundaryWall, pivotDoor, skylight, solarPanels, roofGarden, deck, terrace, diningSet } from '../lib/modern.js';
import { car } from '../lib/props.js';

const LAWN = 0x8db276;

/** Shared lot dressing: lawn plate, a low ivory street wall with an entry gap, back hedge of column trees. */
function lot(group, random, { gapFrom = 0.62, gapTo = 0.96, wallH = 0.08, backTrees = true } = {}) {
  plate(group, 2, 2, LAWN);
  boundaryWall(group, 0.04, 1.9, gapFrom - 0.04, 'x', { h: wallH });
  boundaryWall(group, gapTo, 1.9, 2 - gapTo - 0.04, 'x', { h: wallH });
  boundaryWall(group, 1.9, 0.1, 1.84, 'z', { h: wallH * 0.8, t: 0.035 });
  if (backTrees) for (const x of [0.12, 0.36, 0.6]) columnTree(group, x, 0.1, { scale: 1.05 });
}

// 1. GLASS PAVILION VILLA: one floating roof plane over walls of glass, a stone core and walnut screens.
function glassPavilion(group, random) {
  lot(group, random, { gapFrom: 0.3, gapTo: 0.58 });
  const x0 = 0.22, x1 = 1.62, z0 = 0.3, z1 = 1.08, h = 0.46;
  terrace(group, x0 - 0.04, z0 - 0.04, x1 - x0 + 0.08, z1 - z0 + 0.1, 0, { color: 0xe9e1d2 });
  // Stone core (west) and glazed living volume.
  stoneWall(group, x0, z0, 0.36, h, z1 - z0, { color: LUX.stone });
  box(group, x0 + 0.36, 0.012, z0, x1 - x0 - 0.36, h - 0.012, z1 - z0 - 0.02, mat(0x2e3a40, { rough: 0.9 }));
  glassWall(group, 'south', z1, x0 + 0.36, 0.012, x1 - x0 - 0.36, h - 0.02, { bay: 0.2, lit: (i) => i % 3 !== 1 });
  glassWall(group, 'east', x1, z0, 0.012, z1 - z0, h - 0.02, { bay: 0.2, lit: (i) => i !== 1 });
  // Walnut screen sliding across part of the south glass.
  slats(group, 'south', z1, 1.18, 0.02, 0.3, h - 0.04, { color: LUX.walnut, out: 0.05 });
  // Entrance: deep framed portal in the stone core with a pivot door.
  box(group, x0 + 0.04, 0, z1, 0.3, h, 0.06, mat(LUX.charcoal, { metal: 0.4, rough: 0.4 }));
  pivotDoor(group, 'south', z1 + 0.06, x0 + 0.1, 0.17, 0.34, { color: LUX.walnut });
  sconce(group, 'south', z1 + 0.06, x0 + 0.06, 0.24);
  // The floating roof: thin ivory slab with deep overhangs and a lit soffit line.
  slab(group, x0 - 0.1, z0 - 0.1, x1 + 0.16, z1 + 0.2, h, { t: 0.055, color: LUX.ivory });
  roofDeck(group, x0 - 0.06, z0 - 0.06, x1 + 0.12, z1 + 0.16, h + 0.055, { color: 0xcfc9bd });
  lightLine(group, x0 + 0.38, h - 0.012, z1 + 0.16, x1 - x0 - 0.3, 0.008, 0.012);
  lightLine(group, x1 + 0.12, h - 0.012, z0, 0.012, 0.008, z1 - z0);
  skylight(group, x0 + 0.6, z0 + 0.2, 0.4, 0.2, h + 0.07);
  // Reflecting pool crossed by stepping stones to the door; garden.
  pool(group, 0.66, 1.34, 1.08, 0.3, { water: 0x4fa9b6 });
  steppingStones(group, 0.4, 1.18, 6, 'z', { size: 0.1, gap: 0.03 });
  multiStemTree(group, 1.76, 1.32, random, { scale: 1.1, leaves: 0x7d9a5e });
  for (let i = 0; i < 6; i += 1) grass(group, 0.66 + i * 0.18, 1.74, random);
  planterBox(group, 1.66, 0.36, 0.18, 0.6, random, { plants: 'mix' });
  shrubBall(group, 0.14, 1.62); shrubBall(group, 0.2, 1.74, 0.04);
  for (const [x, z] of [[0.62, 1.86], [1.0, 1.86], [1.38, 1.86], [1.82, 1.86]]) bollardLight(group, x, z);
  lounge(group, 1.7, 1.12, { axis: 'z' });
}

// 2. SCULPTURAL CONCRETE VILLA: asymmetric concrete volumes and a dramatic cantilevered upper storey.
function sculpturalConcrete(group, random) {
  lot(group, random, { gapFrom: 1.12, gapTo: 1.62, backTrees: false });
  const g = 0.44;
  // Ground volume, set back on the west, with a tall glazed slot and a stone plinth.
  box(group, 0.22, 0, 0.34, 0.86, g, 0.78, concrete(0xd9d3c7));
  glassWall(group, 'south', 1.12, 0.3, 0.02, 0.34, g - 0.04, { bay: 0.17, lit: true });
  framedWindow(group, 'south', 1.12, 0.78, 0.1, 0.07, g - 0.16, { surround: LUX.bronze, depth: 0.05, lit: true });
  glassWall(group, 'east', 1.08, 0.5, 0.02, 0.42, g - 0.06, { bay: 0.21 });
  // Upper box cantilevers far east over the driveway: long ribbon window south, slots east.
  const ux0 = 0.5, ux1 = 1.86, uz0 = 0.3, uz1 = 1.02, uy = g, uh = 0.38;
  box(group, ux0, uy, uz0, ux1 - ux0, uh, uz1 - uz0, concrete(0xe3ddd2));
  glassWall(group, 'south', uz1, ux0 + 0.1, uy + 0.1, 0.92, 0.16, { bay: 0.23, frame: LUX.charcoal, lit: (i) => i !== 2 });
  for (let i = 0; i < 4; i += 1) framedWindow(group, 'east', ux1, uz0 + 0.1 + i * 0.15, uy + 0.05, 0.05, uh - 0.1, { surround: LUX.charcoal, depth: 0.03, lit: i % 2 === 0 });
  box(group, ux0 - 0.01, uy + uh, uz0 - 0.01, ux1 - ux0 + 0.02, 0.025, uz1 - uz0 + 0.02, mat(0xe9e4da, { rough: 0.6 }));
  roofDeck(group, ux0 + 0.02, uz0 + 0.02, ux1 - 0.02, uz1 - 0.02, uy + uh + 0.025, { color: 0xbfb8ab, edge: 0xe3ddd2 });
  // Lit soffit under the cantilever, a slim steel column (the only support) and the driveway beneath.
  lightLine(group, 1.12, uy - 0.008, uz1 - 0.04, 0.72, 0.008, 0.012);
  box(group, 1.74, 0, 0.92, 0.025, uy, 0.025, metal());
  driveway(group, 1.16, 0.4, 0.62, 1.52, { joints: 4 });
  car(group, 1.47, 0.72, Math.PI / 2, 0xe8e6e0, random);
  // Planted verge between the drive and the boundary, so the drive reads as part of the garden.
  box(group, 1.8, 0, 0.4, 0.08, 0.012, 1.48, mat(0x6f8f5a, { rough: 1, tex: 'grass' }));
  for (let i = 0; i < 6; i += 1) grass(group, 1.84, 0.5 + i * 0.22, random, { scale: 0.9 });
  for (const z of [1.2, 1.44]) shrubBall(group, 1.3 + (z - 1.2), z + 0.2, 0.035);
  // Entry: stone path, bronze-framed door under the overhang, light lines on the step.
  path(group, 0.62, 1.12, 0.18, 0.78, 0xe2d8c4);
  pivotDoor(group, 'south', 1.12, 0.64, 0.14, 0.34, { color: 0x6b4a33 });
  lightLine(group, 0.58, 0.004, 1.2, 0.26, 0.006, 0.012);
  // Gravel garden with a sculptural tree, grasses and a boulder.
  box(group, 0.08, 0, 1.24, 0.5, 0.008, 0.6, mat(0xd8d1c3, { rough: 1, tex: 'paving', texScale: 0.3 }));
  multiStemTree(group, 0.3, 1.5, random, { scale: 1.2, leaves: 0x8a9f68, stems: 4 });
  for (let i = 0; i < 5; i += 1) grass(group, 0.14 + random() * 0.4, 1.3 + random() * 0.5, random);
  box(group, 0.82, 0, 1.4, 0.12, 0.05, 0.09, stone(0xbdb2a0), 0.02);
  for (let i = 0; i < 4; i += 1) grass(group, 0.86 + i * 0.07, 1.62, random, { scale: 0.9 });
  for (const z of [0.5, 0.9, 1.3, 1.7]) bollardLight(group, 1.08, z);
}

// 3. MINIMAL COURTYARD VILLA: an L of low volumes around a private court, screened in timber.
function minimalCourtyard(group, random) {
  plate(group, 2, 2, LAWN);
  const h = 0.42;
  // West wing (long, toward the street) and north wing (across the back).
  box(group, 0.16, 0, 0.26, 0.5, h, 1.46, plasterMat(LUX.warmWhite));
  box(group, 0.66, 0, 0.26, 1.12, h, 0.46, plasterMat(LUX.warmWhite));
  slab(group, 0.1, 0.2, 0.74, 1.78, h, { t: 0.045, color: LUX.ivory });
  slab(group, 0.66, 0.2, 1.86, 0.78, h, { t: 0.045, color: LUX.ivory });
  roofDeck(group, 0.12, 0.22, 0.72, 1.76, h + 0.045);
  roofDeck(group, 0.72, 0.22, 1.84, 0.76, h + 0.045);
  // Garden-facing glass onto the courtyard (east face of the west wing, south face of the north wing).
  glassWall(group, 'east', 0.66, 0.74, 0.02, 0.86, h - 0.05, { bay: 0.22, lit: (i) => i % 2 === 0 });
  glassWall(group, 'south', 0.72, 0.72, 0.02, 1.0, h - 0.05, { bay: 0.2, lit: (i) => i !== 3 });
  slats(group, 'south', 0.72, 1.38, 0.02, 0.34, h - 0.06, { color: LUX.oak, out: 0.04 });
  // Street face of the west wing: one deep framed window and a walnut-clad portal entrance.
  framedWindow(group, 'south', 1.72, 0.22, 0.12, 0.22, 0.22, { surround: LUX.walnut, depth: 0.06, material: walnut() });
  box(group, 0.66, 0, 1.56, 0.06, 0.34, 0.2, walnut());
  // Courtyard: timber screen walls on the street and east sides with a framed portal gate.
  slatScreen(group, 0.72, 1.74, 0.42, 0.24, 'x', { color: LUX.walnut });
  slatScreen(group, 1.5, 1.74, 0.36, 0.24, 'x', { color: LUX.walnut });
  slatScreen(group, 1.84, 0.8, 0.94, 0.24, 'z', { color: LUX.walnut });
  box(group, 1.14, 0, 1.72, 0.035, 0.3, 0.06, metal()); box(group, 1.465, 0, 1.72, 0.035, 0.3, 0.06, metal());
  box(group, 1.14, 0.3, 1.72, 0.36, 0.03, 0.06, metal());
  // Inside the court: stone path, lawn, a specimen tree in a stone bed, grasses and a shallow basin.
  steppingStones(group, 1.26, 0.84, 6, 'z', { size: 0.12, gap: 0.035 });
  steppingStones(group, 0.9, 1.42, 3, 'x', { size: 0.12, gap: 0.04 });
  box(group, 0.82, 0, 0.88, 0.32, 0.04, 0.32, stone(0xcbbfa8));
  multiStemTree(group, 0.98, 1.04, random, { scale: 1.35, leaves: 0x6f9658, stems: 3 });
  pool(group, 1.44, 0.92, 0.32, 0.22, { water: 0x58aeb8 });
  for (let i = 0; i < 7; i += 1) grass(group, 0.8 + random() * 0.4, 1.3 + random() * 0.35, random);
  for (const [x, z] of [[1.6, 1.3], [1.7, 1.5], [1.56, 1.6]]) shrubBall(group, x, z, 0.04);
  // Street edge: stone apron and bollards; trees behind.
  terrace(group, 0.04, 1.8, 1.92, 0.16, 0, { color: 0xe4dbc9 });
  for (const x of [0.4, 1.06, 1.56]) bollardLight(group, x, 1.88);
  columnTree(group, 1.9, 0.2); columnTree(group, 1.9, 0.44);
}

// 4. SKY TERRACE VILLA: stepped volumes topped by a generous terrace, glass balustrades, pergola and planting.
function skyTerrace(group, random) {
  lot(group, random, { gapFrom: 0.86, gapTo: 1.16 });
  const g = 0.42, u = 0.4;
  // Ground floor: wide, stone base on the east, full glazing on the south.
  box(group, 0.22, 0, 0.3, 1.5, g, 0.84, plasterMat(LUX.warmWhite));
  stoneWall(group, 1.32, 0.3, 0.4, g, 0.84, { color: LUX.sandstone, cap: LUX.ivory });
  glassWall(group, 'south', 1.14, 0.28, 0.02, 0.98, g - 0.06, { bay: 0.2, lit: (i) => i !== 2 });
  framedWindow(group, 'east', 1.72, 0.5, 0.12, 0.3, 0.2, { surround: LUX.charcoal });
  slab(group, 0.16, 0.24, 1.8, 1.24, g, { t: 0.05, color: LUX.ivory });
  // Upper floor: set back to the west, walnut-clad with a corner window.
  box(group, 0.22, g + 0.05, 0.3, 0.78, u, 0.62, walnut(0x83603f));
  framedWindow(group, 'south', 0.92, 0.3, g + 0.12, 0.5, 0.24, { surround: LUX.charcoal, lit: true });
  glassWall(group, 'east', 1.0, 0.36, g + 0.09, 0.5, u - 0.1, { bay: 0.25 });
  slab(group, 0.16, 0.24, 1.08, 0.98, g + 0.05 + u, { t: 0.045, color: LUX.ivory });
  roofGarden(group, 0.24, 0.32, 1.0, 0.9, g + 0.095 + u, random);
  // The sky terrace on the ground floor roof: deck, glass balustrade, slim pergola, lounge and planters.
  deck(group, 1.0, 0.3, 0.76, 0.9, g + 0.05);
  deck(group, 0.22, 0.92, 0.78, 0.28, g + 0.05);
  glassRail(group, 0.18, g + 0.064, 1.2, 1.6, 'x', { h: 0.1 });
  glassRail(group, 1.76, g + 0.064, 0.28, 0.94, 'z', { h: 0.1 });
  const top = new THREE.Group(); top.position.y = g + 0.064; group.add(top);
  slimPergola(top, 1.08, 0.36, 0.6, 0.5, 0.26, { beams: 10 });
  lounge(top, 1.22, 0.52);
  planterBox(top, 1.06, 0.98, 0.64, 0.12, random, { h: 0.06, plants: 'mix' });
  planterBox(top, 0.3, 1.02, 0.6, 0.1, random, { h: 0.05 });
  // Entrance and garden.
  pivotDoor(group, 'south', 1.14, 1.0, 0.14, 0.34, { color: LUX.walnut });
  path(group, 0.98, 1.14, 0.2, 0.76, 0xe6dccb);
  lightLine(group, 0.24, g - 0.01, 1.2, 1.5, 0.008, 0.012);
  multiStemTree(group, 0.4, 1.5, random, { scale: 1.15, leaves: 0x7c9b5f });
  for (let i = 0; i < 5; i += 1) grass(group, 0.62 + i * 0.07, 1.68, random);
  for (let i = 0; i < 4; i += 1) shrubBall(group, 1.3 + i * 0.13, 1.5 + (i % 2) * 0.1, 0.04);
  bollardLight(group, 0.95, 1.84); bollardLight(group, 1.2, 1.84);
}

// 5. LINEAR MODERN VILLA: a long, low composition of layered volumes and a natural stone wall with a lap pool.
function linearModern(group, random) {
  plate(group, 2, 2, LAWN);
  const h = 0.36;
  // Long single-storey bar spanning the lot, with full glass on the south.
  box(group, 0.1, 0, 0.5, 1.8, h, 0.46, ivoryMat(LUX.ivory));
  glassWall(group, 'south', 0.96, 0.52, 0.02, 1.1, h - 0.06, { bay: 0.22, lit: (i) => i % 2 === 1 || i === 0 });
  glassWall(group, 'east', 1.9, 0.56, 0.02, 0.34, h - 0.06, { bay: 0.17 });
  slab(group, 0.04, 0.44, 1.98, 1.06, h, { t: 0.045, color: LUX.ivory });
  roofDeck(group, 0.06, 0.46, 1.96, 1.04, h + 0.045);
  solarPanels(group, 1.2, 0.54, 5, 2, h + 0.05);
  // Upper layer: a shorter, darker volume sliding west, with a long ribbon window.
  box(group, 0.14, h + 0.045, 0.42, 0.86, 0.32, 0.44, mat(0x4a4f52, { rough: 0.6, tex: 'concrete', texScale: 0.4 }));
  glassWall(group, 'south', 0.86, 0.22, h + 0.12, 0.7, 0.14, { bay: 0.23, frame: 0x2b2f31, lit: true });
  slab(group, 0.08, 0.36, 1.06, 0.92, h + 0.365, { t: 0.04, color: LUX.ivory });
  // The stone feature wall slices through the composition and runs past it into the garden.
  stoneWall(group, 0.02, 0.96, 0.46, h + 0.14, 0.07, { color: LUX.stone });
  stoneWall(group, 0.36, 0.96, 0.08, h, 0.36, { color: LUX.stone });
  // Refined entry canopy: a thin slab cantilevered from the stone wall, door beneath.
  slab(group, 0.38, 0.96, 0.66, 1.26, h - 0.04, { t: 0.03, color: LUX.ivory, reveal: false });
  lightLine(group, 0.44, h - 0.045, 1.22, 0.18, 0.006, 0.01);
  pivotDoor(group, 'south', 0.96, 0.46, 0.13, 0.3, { color: LUX.walnut });
  // Long lap pool along the garden, timber deck, loungers and a planted strip.
  deck(group, 0.7, 1.06, 1.24, 0.2);
  pool(group, 0.74, 1.32, 1.14, 0.18, { water: 0x4ea6b5 });
  loungers(group, 1.52, 1.06, 3, { axis: 'z' });
  path(group, 0.44, 1.26, 0.16, 0.66, 0xe2d8c4);
  for (let i = 0; i < 9; i += 1) grass(group, 0.72 + i * 0.13, 1.68, random, { scale: 1.05 });
  for (let i = 0; i < 4; i += 1) columnTree(group, 0.12 + i * 0.24, 0.2);
  multiStemTree(group, 0.18, 1.56, random, { scale: 1.1, leaves: 0x86a066 });
  boundaryWall(group, 0.04, 1.92, 0.36, 'x', { material: stone(LUX.stone) });
  boundaryWall(group, 0.64, 1.92, 1.32, 'x', { h: 0.06 });
  for (const x of [0.7, 1.1, 1.5, 1.88]) bollardLight(group, x, 1.84);
}

// 6. TROPICAL MINIMALIST VILLA: crisp white boxes shaded by deep balconies and timber sun slats around a
// tropical courtyard with a plunge pool.
function tropicalMinimalist(group, random) {
  lot(group, random, { gapFrom: 0.3, gapTo: 0.56, backTrees: false });
  const g = 0.42, u = 0.4;
  // Ground floor: glass-walled living room opening to the deck.
  box(group, 0.2, 0, 0.26, 1.1, g, 0.74, plasterMat(LUX.warmWhite));
  glassWall(group, 'south', 1.0, 0.56, 0.02, 0.72, g - 0.05, { bay: 0.24, lit: (i) => i !== 1 });
  glassWall(group, 'east', 1.3, 0.34, 0.02, 0.6, g - 0.05, { bay: 0.2 });
  // Upper floor projects south over a deep shaded balcony, with horizontal timber sun slats.
  box(group, 0.16, g, 0.22, 1.2, u, 0.62, plasterMat(LUX.warmWhite));
  box(group, 0.16, g, 0.84, 1.2, 0.04, 0.3, plasterMat(LUX.ivory));
  glassWall(group, 'south', 0.84, 0.22, g + 0.06, 1.08, u - 0.1, { bay: 0.22, lit: (i) => i % 2 === 0 });
  // Deep balcony frame: side walls and a walnut soffit, with a full screen of horizontal timber sun slats
  // across the east half of its opening.
  box(group, 0.16, g + 0.04, 0.84, 0.05, u - 0.04, 0.3, plasterMat(LUX.ivory));
  box(group, 1.31, g + 0.04, 0.84, 0.05, u - 0.04, 0.3, plasterMat(LUX.ivory));
  box(group, 0.21, g + u - 0.025, 0.84, 1.1, 0.02, 0.3, walnut());
  slats(group, 'south', 1.14, 0.66, g + 0.04, 0.65, u - 0.06, { horizontal: true, color: LUX.walnut, out: 0.0, gap: 0.034, size: 0.018 });
  glassRail(group, 0.21, g + 0.04, 1.11, 0.45, 'x', { h: 0.1 });
  // Timber-clad ground-floor wall beside the entrance and a stone base course.
  box(group, 0.2, 0, 1.0, 0.32, g - 0.01, 0.025, walnut());
  box(group, 0.18, 0, 0.24, 1.14, 0.03, 0.78, stone(LUX.sandstone));
  planterBox(group, 0.2, 0.9, 0.38, 0.08, random, { h: 0.05, plants: 'mix' });
  // Wide thin roof with a big overhang for shade.
  slab(group, 0.06, 0.12, 1.46, 1.22, g + u, { t: 0.05, color: LUX.ivory });
  roofDeck(group, 0.1, 0.16, 1.42, 1.18, g + u + 0.05);
  lightLine(group, 0.2, g + u - 0.01, 1.18, 1.1, 0.008, 0.012);
  // Tropical courtyard on the east: plunge pool, deck, daybed, bananas, palms and a fan palm.
  deck(group, 1.34, 0.26, 0.56, 0.98);
  pool(group, 1.42, 0.36, 0.38, 0.5, { water: 0x45b2bf, coping: 0xe0d2b6 });
  loungers(group, 1.46, 0.98, 3, { axis: 'z' });
  bananaPlant(group, 1.84, 0.3, random, { scale: 1.05 });
  fanPalm(group, 1.82, 1.36, random, { scale: 0.95 });
  palm(group, 1.7, 1.66, random, { scale: 1.15, lean: 0.18 });
  for (let i = 0; i < 6; i += 1) shrub(group, 0.7 + i * 0.16, 1.74, random, { scale: 1.05, color: i % 2 ? 0x4f8a4a : 0x5f9a50 });
  // Entrance under the balcony shade.
  pivotDoor(group, 'south', 1.0, 0.3, 0.14, 0.34, { color: LUX.walnut });
  steppingStones(group, 0.33, 1.2, 5, 'z', { size: 0.1, gap: 0.035 });
  bananaPlant(group, 0.14, 1.4, random, { scale: 0.85 });
  multiStemTree(group, 0.12, 0.18, random, { scale: 1.0, leaves: 0x5f8f4f });
  diningSet(group, 0.72, 1.06);
  bollardLight(group, 0.3, 1.84); bollardLight(group, 0.58, 1.84);
}

const BUILDERS = [
  ['glass-pavilion', glassPavilion], ['sculptural-concrete', sculpturalConcrete], ['minimal-courtyard', minimalCourtyard],
  ['sky-terrace', skyTerrace], ['linear-modern', linearModern], ['tropical-minimalist', tropicalMinimalist],
];

export function lmVillaAssets() {
  return BUILDERS.flatMap(([slug, build], index) => ['S', 'E'].map((front) => ({
    id: `lm.villa.${slug}.${front}`, model: `lm.villa.${slug}`, kind: 'villa', variant: index, front, footprint: { w: 2, d: 2 },
    build: (group) => { build(group, rng(31_000 + index * 101)); return group; },
  })));
}

export { glass, bronze, fins, carport };
