// Villa (2×2): a one-and-a-half storey coastal house with a garden lot. Built facing south (+Z); the bake harness
// mirrors it across the diagonal for lots whose road is on the east side. Top of roof stays under the game's
// clickable height (buildingLift 30 + cap 8 px ≈ 1.1 units).
import * as THREE from 'three';
import { PALETTE as P, mat, box, plate, roof, windowOn, doorOn, balconyOn, bandOn, hedge, planter, flowerbed, path, palm, broadleaf, cypress, shrub, umbrella, rng, glass } from '../lib/kit.js';

export const VILLA_VARIANTS = [
  { wall: P.ivory, trim: P.white, roof: P.roofTerracotta, shutters: P.teal, hip: true, yard: 'pool', tree: 'palm', door: P.teal },
  { wall: 0xf4dcc8, trim: P.ivory, roof: P.roofSlate, shutters: 0x7d9a8a, hip: false, yard: 'patio', tree: 'broadleaf', door: P.walnut },
  { wall: 0xe9f0e6, trim: P.white, roof: P.roofTeal, shutters: P.coral, hip: true, yard: 'garden', tree: 'blossom', door: P.coral },
  { wall: P.cream, trim: P.white, roof: P.roofSand, shutters: 0x5f8fa8, hip: false, yard: 'pool', tree: 'cypress', door: 0x5f8fa8 },
];

function water(parent, x, z, w, d) {
  box(parent, x - 0.05, 0, z - 0.05, w + 0.1, 0.035, d + 0.1, mat(P.ivory, { rough: 0.6 }), 0.01);
  const m = new THREE.MeshPhysicalMaterial({ color: 0x3fb6c4, roughness: 0.04, metalness: 0.05, clearcoat: 1, envMapIntensity: 1.6 });
  box(parent, x, 0.012, z, w, 0.03, d, m);
  // Steps and a lighter shallow end.
  box(parent, x + 0.02, 0.016, z + 0.02, w * 0.25, 0.028, d - 0.04, new THREE.MeshPhysicalMaterial({ color: 0x7fd6d8, roughness: 0.05, clearcoat: 1 }));
}

function lounger(parent, x, z, color) {
  box(parent, x, 0.02, z, 0.07, 0.025, 0.16, mat(P.ivory), 0.008);
  box(parent, x + 0.005, 0.045, z, 0.06, 0.012, 0.11, mat(color, { rough: 0.9 }), 0.004);
  const back = box(parent, x + 0.005, 0.05, z - 0.01, 0.06, 0.012, 0.06, mat(color, { rough: 0.9 }), 0.004);
  back.rotation.x = -0.6;
}

export function buildVilla(group, variantIndex, seed) {
  const v = VILLA_VARIANTS[variantIndex % VILLA_VARIANTS.length];
  const random = rng(seed);
  plate(group, 2, 2, 0x86ad70);
  // Garden edges: hedge on the back and sides, low along the front with a gap for the path.
  hedge(group, 0.03, 0.03, 1.94, 'x', { h: 0.1, w: 0.08 });
  hedge(group, 0.03, 0.11, 1.4, 'z', { h: 0.09, w: 0.08 });
  hedge(group, 1.89, 0.11, 0.9, 'z', { h: 0.09, w: 0.08 });
  hedge(group, 0.03, 1.9, 0.52, 'x', { h: 0.07, w: 0.07, color: P.moss });
  hedge(group, 0.86, 1.9, 0.22, 'x', { h: 0.07, w: 0.07, color: P.moss });

  // Main house.
  const x0 = 0.24, x1 = 1.36, z0 = 0.26, z1 = 1.18, wallH = 0.6;
  box(group, x0 - 0.03, 0, z0 - 0.03, x1 - x0 + 0.06, 0.06, z1 - z0 + 0.06, mat(P.stone, { rough: 0.9 }));
  box(group, x0, 0.05, z0, x1 - x0, wallH - 0.05, z1 - z0, mat(v.wall, { rough: 0.88 }));
  bandOn(group, 'south', z1, x0, x1 - x0, wallH - 0.05, { color: v.trim, h: 0.04 });
  bandOn(group, 'east', x1, z0, z1 - z0, wallH - 0.05, { color: v.trim, h: 0.04 });
  // Corner quoins.
  for (const [cx, cz] of [[x1 - 0.035, z1 - 0.035], [x0, z1 - 0.035]]) for (let i = 0; i < 5; i += 1) box(group, cx - 0.005, 0.08 + i * 0.1, cz - 0.005, 0.045, 0.05, 0.045, mat(v.trim));

  doorOn(group, 'south', z1, 0.66, 0.15, 0.3, { color: v.door, frame: v.trim, canopy: v.trim, glazed: true });
  windowOn(group, 'south', z1, 0.34, 0.2, 0.17, 0.25, { frame: v.trim, shutters: v.shutters });
  windowOn(group, 'east', x1, 0.36, 0.2, 0.16, 0.25, { frame: v.trim, shutters: v.shutters });
  roof(group, { x0: x0 - 0.09, z0: z0 - 0.09, x1: x1 + 0.09, z1: z1 + 0.09, y: wallH, rise: 0.4, color: v.roof, ridge: 'x', hip: v.hip, gableColor: v.wall });
  // Projecting front bay with its own gable facing the street.
  const bx0 = 0.92, bx1 = 1.32, bz1 = z1 + 0.16;
  box(group, bx0, 0.05, z1 - 0.2, bx1 - bx0, wallH - 0.05, bz1 - z1 + 0.2, mat(v.wall, { rough: 0.88 }));
  box(group, bx0 - 0.02, 0, z1 - 0.02, bx1 - bx0 + 0.04, 0.06, bz1 - z1 + 0.04, mat(P.stone, { rough: 0.9 }));
  windowOn(group, 'south', bz1, bx0 + 0.09, 0.17, 0.22, 0.3, { frame: v.trim, shutters: null });
  windowOn(group, 'east', bx1, z1 - 0.12, 0.2, 0.1, 0.25, { frame: v.trim, mullion: false });
  roof(group, { x0: bx0 - 0.06, z0: z1 - 0.3, x1: bx1 + 0.06, z1: bz1 + 0.07, y: wallH, rise: 0.27, color: v.roof, ridge: 'z', hip: false, gableColor: v.wall });
  // Round attic vent in the bay gable.
  const vent = new THREE.Mesh(new THREE.CircleGeometry(0.04, 20), mat(v.trim));
  vent.position.set((bx0 + bx1) / 2, wallH + 0.09, bz1 - 0.085); group.add(vent);
  // Chimney.
  box(group, 0.36, 0.7, 0.45, 0.1, 0.36, 0.1, mat(v.trim));
  box(group, 0.345, 1.04, 0.435, 0.13, 0.03, 0.13, mat(P.stone));

  // Garden wing: single storey with a roof terrace.
  const wx0 = x1, wx1 = 1.82, wz0 = 0.42, wz1 = 1.12, wingH = 0.38;
  box(group, wx0, 0, wz0, wx1 - wx0, wingH, wz1 - wz0, mat(v.wall, { rough: 0.88 }));
  box(group, wx0 - 0.01, wingH, wz0 - 0.01, wx1 - wx0 + 0.02, 0.04, wz1 - wz0 + 0.02, mat(v.trim));
  const terrace = box(group, wx0 + 0.02, wingH + 0.04, wz0 + 0.02, wx1 - wx0 - 0.04, 0.008, wz1 - wz0 - 0.04, mat(P.timber, { rough: 0.8 }));
  terrace.receiveShadow = true;
  for (const [ax, az, w, d] of [[wx0, wz1 - 0.012, wx1 - wx0, 0.012], [wx1 - 0.012, wz0, 0.012, wz1 - wz0]]) {
    box(group, ax, wingH + 0.04, az, w, 0.1, d, new THREE.MeshPhysicalMaterial({ color: 0xcfe6ea, roughness: 0.05, transparent: true, opacity: 0.5 }));
  }
  planter(group, wx0 + 0.05, wz0 + 0.05, 0.12, 0.1, random, { h: 0.06 });
  // Glazed garden doors.
  const big = windowOn(group, 'south', wz1, wx0 + 0.07, 0.04, 0.32, 0.27, { frame: P.charcoal, sill: false, tint: 0xa9d2da });
  big.userData.lit = true;
  windowOn(group, 'east', wx1, wz0 + 0.12, 0.12, 0.2, 0.18, { frame: v.trim });
  windowOn(group, 'east', wx1, wz0 + 0.42, 0.12, 0.2, 0.18, { frame: v.trim });

  // Front garden.
  path(group, 0.66, z1, 0.16, 2 - z1 - 0.01, P.paving);
  for (let i = 0; i < 4; i += 1) box(group, 0.665, 0.012, z1 + 0.12 + i * 0.17, 0.15, 0.004, 0.015, mat(0xcfc4b0));
  flowerbed(group, 0.26, z1 + 0.05, 0.34, 0.14, random);
  planter(group, 0.88, z1 + 0.05, 0.14, 0.1, random, { box: P.terracotta, h: 0.07 });
  if (v.yard === 'pool') {
    water(group, 1.4, 1.38, 0.42, 0.44);
    lounger(group, 1.0, 1.5, P.coral);
    lounger(group, 1.12, 1.5, P.coral);
    umbrella(group, 1.12, 1.82, v.shutters);
  } else if (v.yard === 'patio') {
    box(group, 1.36, 0, 1.3, 0.5, 0.025, 0.54, mat(P.timber, { rough: 0.8 }));
    for (let i = 0; i < 6; i += 1) box(group, 1.36, 0.025, 1.3 + i * 0.09, 0.5, 0.002, 0.008, mat(P.walnut));
    umbrella(group, 1.6, 1.56, P.coral);
    lounger(group, 1.02, 1.5, P.ivory);
    flowerbed(group, 0.98, 1.74, 0.3, 0.12, random);
  } else {
    flowerbed(group, 1.38, 1.36, 0.44, 0.22, random);
    flowerbed(group, 1.38, 1.62, 0.44, 0.2, random, [0xb9a3e3, P.ivory, 0xf4a6b8]);
    shrub(group, 1.1, 1.62, random, { scale: 1.2, flowers: 0xf4a6b8 });
    shrub(group, 1.05, 1.82, random, { scale: 1 });
  }
  // Signature tree in the front corner, plus a couple of shrubs.
  if (v.tree === 'palm') palm(group, 0.2, 1.68, random, { scale: 1.02, lean: 0.22 });
  else if (v.tree === 'cypress') { cypress(group, 0.17, 1.55, random, { scale: 1.05 }); cypress(group, 0.17, 1.78, random, { scale: 0.9 }); }
  else broadleaf(group, 0.26, 1.64, random, { scale: 0.95, leaves: v.tree === 'blossom' ? 'blossom' : 'round' });
  shrub(group, 1.88, 1.86, random, { scale: 0.9 });
  shrub(group, 0.14, 0.2, random, { scale: 1.1 });
  broadleaf(group, 1.72, 0.22, random, { scale: 0.8, leaves: 'deep' });
  // Mailbox by the path.
  box(group, 0.88, 0, 1.9, 0.015, 0.1, 0.015, mat(P.charcoal));
  box(group, 0.86, 0.1, 1.88, 0.06, 0.04, 0.05, mat(v.door, { rough: 0.5 }), 0.01);
  return group;
}

export function villaAssets() {
  return VILLA_VARIANTS.flatMap((_, index) => ['S', 'E'].map((front) => ({
    id: `villa.v${index}.${front}`, kind: 'villa', variant: index, front, footprint: { w: 2, d: 2 },
    build: (group) => buildVilla(group, index, 1000 + index * 17),
  })));
}
