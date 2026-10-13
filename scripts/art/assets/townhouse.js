// Townhouse (2×3): a row of narrow three-storey coastal houses with individual facades. Some units have a
// shopfront or café at street level. Built with the street on +Z along a frontage of L units; for an east-facing
// lot the harness builds L = 3, D = 2 and mirrors it across the diagonal so the footprint stays 2×3.
import * as THREE from 'three';
import { PALETTE as P, mat, box, sphere, plate, roof, windowOn, shopfrontOn, doorOn, awningOn, balconyOn, bandOn, planter, path, shrub, broadleaf, umbrella, rng, pick, wallMat, brickMat, stoneMat, leafMat, cylinder } from '../lib/kit.js';
import { windowBox, wallLamp, signOn, pottedPlant, bikeRack, bin, acUnit } from '../lib/props.js';

const FACADES = [
  { wall: 0xf2cdb4, trim: P.ivory, accent: P.terracotta, awning: [P.terracotta, P.ivory], shop: 'BAKERY', sign: ['#7a3b2a', '#f6e3c0'] },
  { wall: 0xcfe6dc, trim: P.white, accent: P.teal, awning: [P.teal, P.ivory], shop: 'SURF', sign: ['#2f5f5c', '#f4f0e4'] },
  { wall: 0xf6e3b8, trim: P.white, accent: 0x5f8fa8, awning: [0x5f8fa8, P.ivory], shop: 'BOOKS', sign: ['#2c3e57', '#f1c45f'] },
  { wall: 0xc9785a, trim: P.ivory, accent: 0x34433f, awning: [P.coral, P.ivory], shop: 'CAFÉ', sign: ['#34433f', '#f6d27a'], brick: true },
  { wall: 0xf4efe6, trim: 0xe9dcc4, accent: P.walnut, awning: [P.gold, P.ivory], shop: 'FLOWERS', sign: ['#5b3a52', '#f8d6e0'] },
];
export const TOWNHOUSE_VARIANTS = [[0, 1, 2], [3, 2, 4], [1, 4, 0]];

/** One unit: x from ux to ux + uw, front wall at z = front, back at z = back. */
function unit(group, random, f, ux, uw, front, back, storeys, storeyH, { shop, last, roofKind }) {
  const height = storeys * storeyH;
  box(group, ux, 0, back, uw, height, front - back, f.brick ? brickMat(f.wall) : wallMat(f.wall));
  box(group, ux - 0.005, 0, front - 0.02, uw + 0.01, 0.07, 0.04, stoneMat());
  // Pilasters between units.
  box(group, ux, 0, front - 0.01, 0.035, height, 0.035, mat(f.trim));
  box(group, ux + uw - 0.035, 0, front - 0.01, 0.035, height, 0.035, mat(f.trim));
  if (shop) {
    shopfrontOn(group, 'south', front, ux + 0.08, uw * 0.58, storeyH * 0.78, { frame: f.accent, lit: true });
    doorOn(group, 'south', front, ux + uw * 0.7, 0.13, storeyH * 0.74, { color: f.accent, frame: f.trim, glazed: true });
    awningOn(group, 'south', front, ux + 0.05, uw - 0.1, storeyH * 0.92, { colors: f.awning, depth: 0.2, drop: 0.1, stripes: 8 });
    signOn(group, 'south', front, ux + uw * 0.16, storeyH * 0.98, uw * 0.68, 0.085, f.shop, { bg: f.sign[0], fg: f.sign[1] });
    wallLamp(group, 'south', front, ux + uw * 0.9, storeyH * 0.7);
    pottedPlant(group, ux + uw * 0.66, front + 0.08, random);
  } else {
    // Raised stoop with steps up to a panelled door.
    box(group, ux + uw * 0.12, 0, front, 0.22, 0.06, 0.16, stoneMat(0xe6dcc6));
    box(group, ux + uw * 0.12, 0, front + 0.16, 0.22, 0.03, 0.06, stoneMat(0xe6dcc6));
    doorOn(group, 'south', front, ux + uw * 0.18, 0.15, storeyH * 0.76, { color: f.accent, frame: f.trim, canopy: f.trim });
    wallLamp(group, 'south', front, ux + uw * 0.12, storeyH * 0.62);
    windowOn(group, 'south', front, ux + uw * 0.56, storeyH * 0.28, uw * 0.3, storeyH * 0.5, { frame: f.trim });
    windowBox(group, 'south', front, ux + uw * 0.55, uw * 0.32, storeyH * 0.28, random);
    pottedPlant(group, ux + uw * 0.1, front + 0.2, random);
  }
  bandOn(group, 'south', front, ux, uw, storeyH - 0.03, { color: f.trim, h: 0.03 });
  for (let s = 1; s < storeys; s += 1) {
    const v = s * storeyH + storeyH * 0.2;
    const tall = s === 1;
    windowOn(group, 'south', front, ux + uw * 0.14, v, uw * 0.3, storeyH * (tall ? 0.6 : 0.52), { frame: f.trim, shutters: s === 2 ? f.accent : null });
    windowOn(group, 'south', front, ux + uw * 0.56, v, uw * 0.3, storeyH * (tall ? 0.6 : 0.52), { frame: f.trim, shutters: s === 2 ? f.accent : null });
    if (!tall) { windowBox(group, 'south', front, ux + uw * 0.13, uw * 0.32, v, random); windowBox(group, 'south', front, ux + uw * 0.55, uw * 0.32, v, random); }
    if (tall) balconyOn(group, 'south', front, ux + uw * 0.08, uw * 0.84, s * storeyH + 0.02, { depth: 0.12, railing: 'bars', color: f.trim });
    else bandOn(group, 'south', front, ux, uw, s * storeyH + 0.01, { color: f.trim, h: 0.02, out: 0.015 });
  }
  if (last) {
    // Exposed end wall: windows, a downpipe, a side door and climbing ivy so the gable end is never blank.
    const span = front - back;
    const cols = span > 1.6 ? [0.18, 0.42, 0.66] : [0.3, 0.62];
    for (let s = 0; s < storeys; s += 1) {
      for (const t of cols) windowOn(group, 'east', ux + uw, back + span * t, s * storeyH + storeyH * 0.24, 0.14, storeyH * 0.5, { frame: f.trim, mullion: false, shutters: s === 1 ? f.accent : null });
    }
    doorOn(group, 'east', ux + uw, back + span * 0.86, 0.12, storeyH * 0.7, { color: f.accent, frame: f.trim });
    box(group, ux + uw, 0, front - 0.06, 0.025, height, 0.025, mat(0x8a9399, { rough: 0.5, metal: 0.4 }));
    const ivy = [0x4f8a5c, 0x5f9654, 0x467f52];
    for (let i = 0; i < 26; i += 1) {
      const z = back + 0.04 + random() * span * 0.16, y = random() * height * (0.35 + 0.65 * (1 - (z - back) / (span * 0.2)));
      sphere(group, ux + uw + 0.015, Math.max(0.03, y), z, 0.035 + random() * 0.025, mat(ivy[i % 3], { rough: 0.95 }), 1);
    }
  }
  // Roof line: cornice plus either a front gable, a mansard or a flat roof terrace.
  box(group, ux - 0.01, height, back - 0.01, uw + 0.02, 0.04, front - back + 0.05, mat(f.trim));
  if (roofKind === 'gable') {
    roof(group, { x0: ux, z0: back, x1: ux + uw, z1: front + 0.03, y: height + 0.04, rise: 0.26, color: pick(random, [P.roofTerracotta, 0xb95c40]), ridge: 'z', hip: false, gableColor: f.brick ? 0xe9dcc4 : f.wall });
    const oculus = new THREE.Mesh(new THREE.CircleGeometry(0.045, 20), mat(f.trim)); oculus.position.set(ux + uw / 2, height + 0.13, front + 0.035); group.add(oculus);
    box(group, ux + uw * 0.7, height + 0.1, back + 0.3, 0.09, 0.3, 0.09, brickMat(0xb86a4f));
    box(group, ux + uw * 0.7 - 0.01, height + 0.4, back + 0.29, 0.11, 0.025, 0.11, stoneMat());
  } else if (roofKind === 'mansard') {
    roof(group, { x0: ux + 0.01, z0: back + 0.01, x1: ux + uw - 0.01, z1: front + 0.02, y: height + 0.04, rise: 0.2, color: P.roofSlate, ridge: 'x', hip: true, tex: 'slate' });
    // Two dormers on the mansard's street slope.
    for (const t of [0.2, 0.58]) {
      box(group, ux + uw * t, height + 0.04, front - 0.16, uw * 0.22, 0.15, 0.12, mat(f.trim));
      windowOn(group, 'south', front - 0.04, ux + uw * t + 0.025, height + 0.07, uw * 0.22 - 0.05, 0.09, { frame: P.white, mullion: false, sill: false });
      roof(group, { x0: ux + uw * t - 0.015, z0: front - 0.18, x1: ux + uw * (t + 0.22) + 0.015, z1: front - 0.02, y: height + 0.19, rise: 0.06, color: P.roofSlate, ridge: 'z', hip: false, gableColor: f.trim, tex: 'slate' });
    }
  } else {
    box(group, ux + 0.04, height + 0.04, back + 0.04, uw - 0.08, 0.06, front - back - 0.06, mat(f.wall));
    box(group, ux + 0.06, height + 0.1, back + 0.06, uw - 0.12, 0.006, front - back - 0.1, mat(0xd9cbb0, { rough: 0.9 }));
    box(group, ux + uw * 0.35, height + 0.106, back + (front - back) * 0.35, uw * 0.5, 0.004, (front - back) * 0.4, mat(P.timber, { rough: 0.8 }));
    const terrace = new THREE.Group();
    terrace.position.y = height + 0.106;
    group.add(terrace);
    planter(terrace, ux + 0.1, front - 0.22, 0.24, 0.08, random, { h: 0.05 });
    planter(terrace, ux + 0.1, back + 0.12, 0.08, 0.3, random, { h: 0.05 });
    umbrella(terrace, ux + uw * 0.6, back + (front - back) * 0.55, f.awning[0]);
    box(group, ux + uw * 0.25, height + 0.1, back + 0.2, 0.16, 0.14, 0.16, mat(f.trim));
  }
}

export function buildTownhouse(group, variantIndex, frontage, depth, seed) {
  const random = rng(seed);
  const scheme = TOWNHOUSE_VARIANTS[variantIndex % TOWNHOUSE_VARIANTS.length];
  plate(group, frontage, depth, 0x86ad70);
  // Sidewalk apron along the street with planters; a small back garden.
  const front = depth - 0.2, back = Math.max(0.4, depth - 2.3);
  path(group, 0, front, frontage, depth - front, P.paving);
  for (let i = 1; i < frontage * 4; i += 1) box(group, i / 4, 0.012, front, 0.006, 0.002, depth - front, mat(0xd4c9b4));
  path(group, 0, back - 0.12, frontage, 0.1, 0xd8ccb5);
  const units = Math.round(frontage);
  const uw = frontage / units;
  const roofs = ['gable', 'flat', 'mansard'];
  for (let i = 0; i < units; i += 1) {
    const f = FACADES[scheme[i % scheme.length]];
    unit(group, random, f, i * uw, uw, front, back, 3, 0.43, { shop: (i + variantIndex) % 2 === 0, last: i === units - 1, roofKind: roofs[(i + variantIndex) % roofs.length] });
  }
  // Back gardens.
  for (let i = 0; i < units; i += 1) {
    if ((i + variantIndex) % 2 === 0) broadleaf(group, i * uw + uw * 0.3, back * 0.45, random, { scale: 0.75, leaves: i % 2 ? 'olive' : 'round' });
    else shrub(group, i * uw + uw * 0.5, back * 0.5, random, { scale: 1.2, flowers: P.coral });
  }
  // Street furniture on the apron: café table, bikes, a bin and a street tree in a grate.
  umbrella(group, frontage * 0.25, depth - 0.1, P.coral);
  bikeRack(group, frontage * 0.55, depth - 0.1, 2, random);
  bin(group, frontage - 0.32, depth - 0.1);
  box(group, frontage - 0.24, 0.012, depth - 0.18, 0.16, 0.004, 0.16, mat(0x5a5f5c, { metal: 0.4 }));
  broadleaf(group, frontage - 0.16, depth - 0.1, random, { scale: 0.85, leaves: 'round' });
  acUnit(group, 'east', frontage, Math.max(back + 0.2, front - 0.6), 0.5);
  return group;
}

export function townhouseAssets() {
  return TOWNHOUSE_VARIANTS.flatMap((_, index) => [
    { id: `townhouse.v${index}.S`, kind: 'townhouse', variant: index, front: 'S', footprint: { w: 2, d: 3 }, build: (g) => buildTownhouse(g, index, 2, 3, 2000 + index * 31) },
    { id: `townhouse.v${index}.E`, kind: 'townhouse', variant: index, front: 'E', footprint: { w: 2, d: 3 }, build: (g) => buildTownhouse(g, index, 3, 2, 2100 + index * 31) },
  ]);
}
