// Semi-detached duplex (3×2), Visual World 3.0B: two mirrored modern coastal homes under twin standing-seam
// gables, white render with timber-clad upper bays, a recessed entrance with canopy at each outer end, upper
// balconies, and private front gardens split by a hedge. Frontage L along +X with the street on +Z.
// South-facing lots build L = 3, D = 2; east-facing lots build L = 2, D = 3 and mirror, so the footprint stays 3×2.
import * as THREE from 'three';
import { PALETTE as P, mat, box, plate, roof, windowOn, doorOn, balconyOn, bandOn, hedge, flowerbed, path, palm, broadleaf, shrub, rng, wallMat, renderMat, woodMat, stoneMat, pavingMat } from '../lib/kit.js';
import { wallLamp, pottedPlant, bikeRack, bin, downpipe, picketFence } from '../lib/props.js';

export const DUPLEX_VARIANTS = [
  { wall: 0xf7f4ee, clad: 0xb07a4f, roof: 0x4d5a62, accent: 0x2f3b40, door: [0xe8b04a, 0x3f8d8a], tree: 'olive' },
  { wall: 0xf1e6d2, clad: 0x8e6a4b, roof: 0x4f8b88, accent: 0x3d464b, door: [0xd8735b, 0x5f8fa8], tree: 'palm' },
  { wall: 0xe9eef0, clad: 0xc0905e, roof: 0xb95c40, accent: 0x34433f, door: [0x3f8d8a, 0xe88b74], tree: 'round' },
];

function home(group, random, v, x0, w, front, back, mirrored, doorColor) {
  const storey = 0.48, wallH = storey * 2 + 0.04;
  box(group, x0, 0, back, w, 0.06, front - back, stoneMat(0xd8cfbd));
  box(group, x0, 0.05, back, w, wallH - 0.05, front - back, renderMat(v.wall));
  // Timber-clad bay around the upper windows.
  const cladU = mirrored ? x0 + 0.05 : x0 + w - 0.05 - w * 0.55;
  box(group, cladU, storey + 0.02, front - 0.005, w * 0.55, storey - 0.04, 0.03, woodMat(v.clad));
  windowOn(group, 'south', front + 0.025, cladU + 0.06, storey + 0.09, w * 0.55 - 0.12, storey * 0.6, { frame: v.accent, mullion: true, sill: false });
  balconyOn(group, 'south', front + 0.025, cladU + 0.02, w * 0.55 - 0.04, storey + 0.02, { depth: 0.14, railing: 'glass', color: P.white });
  // Ground floor: big glazing plus a recessed entrance with canopy at the outer end.
  const doorU = mirrored ? x0 + w - 0.22 : x0 + 0.07;
  const glazeU = mirrored ? x0 + 0.07 : x0 + 0.34;
  box(group, doorU - 0.03, 0, front, 0.21, 0.03, 0.12, stoneMat(0xe6dcc6));
  doorOn(group, 'south', front, doorU, 0.15, 0.36, { color: doorColor, frame: v.accent, glazed: true });
  box(group, doorU - 0.05, 0.42, front, 0.25, 0.025, 0.18, mat(v.accent, { rough: 0.4, metal: 0.3 }));
  wallLamp(group, 'south', front, mirrored ? doorU - 0.06 : doorU + 0.18, 0.3);
  const glaze = windowOn(group, 'south', front, glazeU, 0.08, w - 0.44, 0.32, { frame: v.accent, sill: false, tint: 0xb5d6dc });
  glaze.userData.lit = true;
  // Side windows on the exposed end.
  if (mirrored) for (const t of [0.25, 0.62]) windowOn(group, 'east', x0 + w, back + (front - back) * t, storey + 0.1, 0.16, 0.26, { frame: v.accent, mullion: false });
  bandOn(group, 'south', front, x0, w, wallH - 0.03, { color: P.white, h: 0.03, out: 0.02 });
  roof(group, { x0: x0 - 0.04, z0: back - 0.06, x1: x0 + w + 0.04, z1: front + 0.1, y: wallH, rise: 0.36, color: v.roof, ridge: 'z', hip: false, gableColor: v.wall, tex: 'seam' });
  // Round gable window.
  const vent = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), mat(v.accent));
  vent.position.set(x0 + w / 2, wallH + 0.12, front + 0.03); group.add(vent);
  const glassDisc = new THREE.Mesh(new THREE.CircleGeometry(0.038, 20), new THREE.MeshPhysicalMaterial({ color: 0xa9d2da, roughness: 0.05, clearcoat: 1 }));
  glassDisc.position.set(x0 + w / 2, wallH + 0.12, front + 0.032); glassDisc.userData.window = true; group.add(glassDisc);
  downpipe(group, mirrored ? x0 + 0.02 : x0 + w - 0.02, front + 0.01, wallH);
  return wallH;
}

export function buildDuplex(group, variantIndex, frontage, depth, seed) {
  const v = DUPLEX_VARIANTS[variantIndex % DUPLEX_VARIANTS.length];
  const random = rng(seed);
  plate(group, frontage, depth, 0x86ad70);
  const front = depth - 0.62, back = Math.max(0.2, front - 1.0);
  const half = frontage / 2;
  const inset = frontage >= 3 ? 0.18 : 0.08;
  home(group, random, v, inset, half - inset, front, back, false, v.door[0]);
  home(group, random, v, half, half - inset, front, back, true, v.door[1]);
  // Party wall fin between the two homes.
  box(group, half - 0.025, 0, front - 0.02, 0.05, 1.06, 0.06, mat(v.accent, { rough: 0.5 }));
  // Front gardens: paths to each door, a hedge between them, flowerbeds and a picket fence on the street edge.
  for (const [px, mirrored] of [[inset + 0.04, false], [frontage - inset - 0.24, true]]) {
    path(group, px, front + 0.12, 0.18, depth - front - 0.14, P.paving);
    pottedPlant(group, mirrored ? px - 0.06 : px + 0.24, front + 0.18, random);
  }
  hedge(group, half - 0.05, front + 0.05, depth - front - 0.08, 'z', { h: 0.12, w: 0.1 });
  flowerbed(group, inset + 0.3, front + 0.18, half - inset - 0.42, 0.2, random);
  flowerbed(group, half + 0.12, front + 0.18, half - inset - 0.42, 0.2, random, [0xb9a3e3, P.ivory, P.gold]);
  picketFence(group, 0.02, depth - 0.05, inset + 0.0, 'x');
  picketFence(group, inset + 0.24, depth - 0.05, half - inset - 0.34, 'x');
  picketFence(group, half + 0.1, depth - 0.05, half - inset - 0.36, 'x');
  bikeRack(group, half + 0.25, front + 0.5, 2, random);
  bin(group, inset + 0.3, front + 0.5); bin(group, inset + 0.36, front + 0.5, 0x6f8fb0);
  // Back garden trees peek over the roofs; a feature tree on the open side.
  if (v.tree === 'palm') palm(group, frontage - 0.12, depth - 0.25, random, { scale: 1.2 });
  else broadleaf(group, frontage - 0.15, depth - 0.25, random, { scale: 0.95, leaves: v.tree });
  broadleaf(group, 0.15, Math.max(0.12, back - 0.05), random, { scale: 1.0, leaves: 'deep' });
  shrub(group, frontage - 0.12, Math.max(0.12, back + 0.2), random, { scale: 1.3, flowers: P.coral });
  if (back > 0.8) {
    // Deep lots: private back gardens with a timber deck, a shed, fruit trees and a dividing hedge.
    hedge(group, half - 0.04, 0.06, back - 0.1, 'z', { h: 0.12, w: 0.08 });
    box(group, 0.15, 0, back - 0.42, half - 0.4, 0.02, 0.32, woodMat());
    box(group, half + 0.15, 0, 0.12, 0.3, 0.24, 0.24, woodMat(v.clad));
    roof(group, { x0: half + 0.12, z0: 0.09, x1: half + 0.48, z1: 0.39, y: 0.24, rise: 0.08, color: v.roof, ridge: 'x', hip: false, tex: 'seam' });
    broadleaf(group, 0.3, 0.25, random, { scale: 0.9, leaves: 'lime' });
    broadleaf(group, frontage - 0.25, back - 0.35, random, { scale: 0.85, leaves: 'blossom' });
    flowerbed(group, half + 0.1, back - 0.32, half - 0.3, 0.16, random);
  }
  return group;
}

export function duplexAssets() {
  return DUPLEX_VARIANTS.flatMap((_, index) => [
    { id: `duplex.v${index}.S`, kind: 'duplex', variant: index, front: 'S', footprint: { w: 3, d: 2 }, build: (g) => buildDuplex(g, index, 3, 2, 1500 + index * 23) },
    { id: `duplex.v${index}.E`, kind: 'duplex', variant: index, front: 'E', footprint: { w: 3, d: 2 }, build: (g) => buildDuplex(g, index, 2, 3, 1600 + index * 23) },
  ]);
}
