// Villa (2×2), Visual World 3.0B: a two-storey coastal villa with a columned portico, wrought-iron balcony,
// shuttered windows with flower boxes, a garden wing with a vine-covered pergola terrace, and a walled front
// garden. Built facing south (+Z); the harness mirrors it for east-facing lots.
import * as THREE from 'three';
import { PALETTE as P, mat, box, cylinder, plate, roof, windowOn, doorOn, balconyOn, bandOn, hedge, flowerbed, path, palm, broadleaf, cypress, shrub, umbrella, rng, wallMat, stoneMat, woodMat, pavingMat, waterMat } from '../lib/kit.js';
import { windowBox, wallLamp, downpipe, pottedPlant, pergola, lowWall, bikeRack } from '../lib/props.js';

export const VILLA_VARIANTS = [
  { wall: 0xfaf1e2, trim: P.white, roof: 0xc8674a, shutters: 0x3f8d8a, hip: true, yard: 'pool', tree: 'palm', door: 0x3f8d8a, box: P.timber },
  { wall: 0xf6d9c4, trim: P.ivory, roof: 0x5d6f78, shutters: 0x7d9a8a, hip: false, yard: 'patio', tree: 'olive', door: 0x7a5236, box: 0x7d9a8a },
  { wall: 0xeef3ea, trim: P.white, roof: 0x4f8b88, shutters: 0xd8735b, hip: true, yard: 'garden', tree: 'jacaranda', door: 0xd8735b, box: P.ivory },
  { wall: 0xf3e3c3, trim: P.white, roof: 0xb95c40, shutters: 0x5f8fa8, hip: false, yard: 'pool', tree: 'cypress', door: 0x5f8fa8, box: P.timber },
];

function water(parent, x, z, w, d) {
  box(parent, x - 0.05, 0, z - 0.05, w + 0.1, 0.035, d + 0.1, mat(P.ivory, { rough: 0.6, tex: 'paving', texScale: 0.5 }), 0.01);
  box(parent, x, 0.012, z, w, 0.03, d, waterMat(0x3fb6c4));
  box(parent, x + 0.02, 0.016, z + 0.02, w * 0.25, 0.028, d - 0.04, new THREE.MeshPhysicalMaterial({ color: 0x7fd6d8, roughness: 0.05, clearcoat: 1 }));
  for (const dz of [0.06, 0.12]) box(parent, x + w - 0.02, 0.03, z + dz, 0.012, 0.08, 0.012, mat(0xdfe6e8, { metal: 0.8, rough: 0.2 }));
}
function lounger(parent, x, z, color) {
  box(parent, x, 0.02, z, 0.07, 0.025, 0.16, mat(P.ivory), 0.008);
  box(parent, x + 0.005, 0.045, z, 0.06, 0.012, 0.11, mat(color, { rough: 0.9, tex: 'fabric' }), 0.004);
  const back = box(parent, x + 0.005, 0.05, z - 0.01, 0.06, 0.012, 0.06, mat(color, { rough: 0.9, tex: 'fabric' }), 0.004);
  back.rotation.x = -0.6;
}

export function buildVilla(group, variantIndex, seed) {
  const v = VILLA_VARIANTS[variantIndex % VILLA_VARIANTS.length];
  const random = rng(seed);
  plate(group, 2, 2, 0x86ad70);
  // Walled front garden: stone wall with gate piers, hedges behind it, hedges on the sides and back.
  lowWall(group, 0.04, 1.9, 0.5, 'x', 0.07); lowWall(group, 0.92, 1.9, 1.04, 'x', 0.07);
  for (const gx of [0.52, 0.86]) { box(group, gx, 0, 1.88, 0.07, 0.13, 0.08, stoneMat(0xe0d6c2), 0.01); box(group, gx - 0.005, 0.13, 1.875, 0.08, 0.02, 0.09, mat(v.trim)); }
  hedge(group, 0.04, 1.8, 0.46, 'x', { h: 0.11, w: 0.08 }); hedge(group, 1.32, 1.8, 0.62, 'x', { h: 0.11, w: 0.08 });
  hedge(group, 0.03, 0.03, 1.94, 'x', { h: 0.14, w: 0.09 });
  hedge(group, 0.03, 0.12, 1.6, 'z', { h: 0.12, w: 0.08 });
  hedge(group, 1.89, 0.12, 1.0, 'z', { h: 0.12, w: 0.08 });

  // Main house: two storeys.
  const x0 = 0.24, x1 = 1.3, z0 = 0.26, z1 = 1.12, g = 0.5, wallH = 0.94;
  box(group, x0 - 0.03, 0, z0 - 0.03, x1 - x0 + 0.06, 0.07, z1 - z0 + 0.06, stoneMat());
  box(group, x0, 0.06, z0, x1 - x0, wallH - 0.06, z1 - z0, wallMat(v.wall));
  bandOn(group, 'south', z1, x0, x1 - x0, g - 0.02, { color: v.trim, h: 0.03, out: 0.02 });
  bandOn(group, 'east', x1, z0, z1 - z0, g - 0.02, { color: v.trim, h: 0.03, out: 0.02 });
  bandOn(group, 'south', z1, x0, x1 - x0, wallH - 0.05, { color: v.trim, h: 0.05, out: 0.035 });
  bandOn(group, 'east', x1, z0, z1 - z0, wallH - 0.05, { color: v.trim, h: 0.05, out: 0.035 });
  for (const [cx, cz] of [[x1 - 0.035, z1 - 0.035], [x0, z1 - 0.035]]) for (let i = 0; i < 9; i += 1) box(group, cx - 0.006, 0.09 + i * 0.095, cz - 0.006, 0.047 - (i % 2) * 0.012, 0.05, 0.047 - (i % 2) * 0.012, mat(v.trim));
  downpipe(group, x1 + 0.01, z1 - 0.06, wallH);

  // Portico with columns and a balcony above it.
  const px0 = 0.56, px1 = 0.98;
  box(group, px0 - 0.02, 0, z1, px1 - px0 + 0.04, 0.05, 0.22, stoneMat(0xe6dcc6));
  for (const cx of [px0 + 0.02, px1 - 0.05]) cylinder(group, cx + 0.015, 0.05, z1 + 0.17, 0.022, 0.026, 0.38, mat(v.trim, { rough: 0.6 }), 14);
  box(group, px0 - 0.03, 0.43, z1 - 0.01, px1 - px0 + 0.06, 0.04, 0.24, mat(v.trim));
  balconyOn(group, 'south', z1, px0 - 0.02, px1 - px0 + 0.04, 0.47, { depth: 0.22, railing: 'bars', color: v.trim });
  doorOn(group, 'south', z1, 0.7, 0.15, 0.36, { color: v.door, frame: v.trim, glazed: true });
  wallLamp(group, 'south', z1, 0.63, 0.3); wallLamp(group, 'south', z1, 0.88, 0.3);
  windowOn(group, 'south', z1, 0.67, g + 0.06, 0.2, 0.3, { frame: v.trim });
  for (const u of [0.3, 1.06]) {
    windowOn(group, 'south', z1, u, 0.14, 0.16, 0.27, { frame: v.trim, shutters: v.shutters });
    windowBox(group, 'south', z1, u - 0.01, 0.18, 0.14, random, v.box);
    windowOn(group, 'south', z1, u, g + 0.08, 0.16, 0.26, { frame: v.trim, shutters: v.shutters });
    windowBox(group, 'south', z1, u - 0.01, 0.18, g + 0.08, random, v.box);
  }
  for (const u of [0.36, 0.78]) windowOn(group, 'east', x1, u, g + 0.08, 0.15, 0.26, { frame: v.trim, shutters: v.shutters });
  windowOn(group, 'east', x1, 0.36, 0.14, 0.15, 0.27, { frame: v.trim, shutters: v.shutters });

  roof(group, { x0: x0 - 0.1, z0: z0 - 0.1, x1: x1 + 0.1, z1: z1 + 0.1, y: wallH, rise: 0.4, color: v.roof, ridge: 'x', hip: v.hip, gableColor: v.wall });
  box(group, 0.34, 1.0, 0.42, 0.11, 0.42, 0.11, wallMat(v.trim));
  box(group, 0.325, 1.42, 0.405, 0.14, 0.03, 0.14, stoneMat());
  cylinder(group, 0.395, 1.45, 0.475, 0.02, 0.02, 0.04, mat(0x7a5236), 8);

  // Garden wing with roof terrace under a vine pergola.
  const wx0 = x1, wx1 = 1.8, wz0 = 0.42, wz1 = 1.1, wingH = 0.46;
  box(group, wx0, 0, wz0, wx1 - wx0, wingH, wz1 - wz0, wallMat(v.wall));
  box(group, wx0 - 0.01, wingH, wz0 - 0.01, wx1 - wx0 + 0.02, 0.04, wz1 - wz0 + 0.02, mat(v.trim));
  box(group, wx0 + 0.02, wingH + 0.04, wz0 + 0.02, wx1 - wx0 - 0.04, 0.008, wz1 - wz0 - 0.04, woodMat());
  const railing = new THREE.MeshPhysicalMaterial({ color: 0xcfe6ea, roughness: 0.05, transparent: true, opacity: 0.5 });
  box(group, wx0, wingH + 0.04, wz1 - 0.012, wx1 - wx0, 0.1, 0.012, railing);
  box(group, wx1 - 0.012, wingH + 0.04, wz0, 0.012, 0.1, wz1 - wz0, railing);
  const terrace = new THREE.Group(); terrace.position.y = wingH + 0.048; group.add(terrace);
  pergola(terrace, wx0 + 0.04, wz0 + 0.06, 0.38, 0.5, 0.26, P.timber, random);
  umbrella(terrace, wx0 + 0.2, wz0 + 0.33, v.shutters);
  const garden = windowOn(group, 'south', wz1, wx0 + 0.06, 0.04, 0.34, 0.32, { frame: P.charcoal, sill: false, tint: 0xa9d2da });
  garden.userData.lit = true;
  windowOn(group, 'east', wx1, wz0 + 0.1, 0.14, 0.2, 0.22, { frame: v.trim });
  windowOn(group, 'east', wx1, wz0 + 0.4, 0.14, 0.2, 0.22, { frame: v.trim });

  // Front garden.
  path(group, 0.66, z1 + 0.22, 0.2, 2 - z1 - 0.24, P.paving);
  flowerbed(group, 0.26, z1 + 0.05, 0.28, 0.16, random);
  pottedPlant(group, 0.6, z1 + 0.26, random); pottedPlant(group, 0.92, z1 + 0.26, random);
  if (v.yard === 'pool') {
    water(group, 1.4, 1.36, 0.42, 0.42);
    box(group, 0.98, 0, 1.32, 0.36, 0.02, 0.44, pavingMat(0xeae0cc));
    lounger(group, 1.04, 1.42, P.coral); lounger(group, 1.16, 1.42, P.coral);
    umbrella(group, 1.24, 1.78, v.shutters);
  } else if (v.yard === 'patio') {
    box(group, 1.36, 0, 1.3, 0.5, 0.025, 0.52, woodMat());
    umbrella(group, 1.6, 1.56, P.coral);
    lounger(group, 1.04, 1.44, P.ivory);
    flowerbed(group, 0.98, 1.66, 0.3, 0.12, random);
    bikeRack(group, 1.42, 1.78, 2, random);
  } else {
    flowerbed(group, 1.38, 1.34, 0.44, 0.22, random);
    flowerbed(group, 1.38, 1.6, 0.44, 0.18, random, [0xb9a3e3, P.ivory, 0xf4a6b8]);
    shrub(group, 1.12, 1.6, random, { scale: 1.4, flowers: 0xd94f8a });
    shrub(group, 1.05, 1.36, random, { scale: 1.1 });
  }
  if (v.tree === 'palm') { palm(group, 0.2, 1.62, random, { scale: 1.3, lean: 0.22 }); palm(group, 0.36, 1.72, random, { scale: 1.05, lean: 0.3 }); }
  else if (v.tree === 'cypress') { cypress(group, 0.16, 1.5, random, { scale: 1.3 }); cypress(group, 0.17, 1.74, random, { scale: 1.1 }); }
  else broadleaf(group, 0.27, 1.6, random, { scale: 1.05, leaves: v.tree === 'jacaranda' ? 'jacaranda' : 'olive' });
  shrub(group, 1.86, 1.84, random, { scale: 1.1 });
  shrub(group, 0.14, 0.2, random, { scale: 1.3 });
  broadleaf(group, 1.7, 0.22, random, { scale: 0.95, leaves: 'deep' });
  box(group, 0.4, 0, 1.9, 0.015, 0.1, 0.015, mat(P.charcoal));
  box(group, 0.38, 0.1, 1.88, 0.06, 0.04, 0.05, mat(v.door, { rough: 0.5 }), 0.01);
  return group;
}

export function villaAssets() {
  return VILLA_VARIANTS.flatMap((_, index) => ['S', 'E'].map((front) => ({
    id: `villa.v${index}.${front}`, kind: 'villa', variant: index, front, footprint: { w: 2, d: 2 },
    build: (group) => buildVilla(group, index, 1000 + index * 17),
  })));
}
