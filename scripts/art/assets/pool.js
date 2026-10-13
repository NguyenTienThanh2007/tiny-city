// Swimming pool (3×4), Visual World 3.0B: a community lido with a tiled deck, a lane pool with lane ropes and a
// rounded kids' pool, ladders, a diving board, a lifeguard chair, rows of loungers under umbrellas, a striped
// cabana with changing rooms, and tropical planting behind a hedge. Footprint 3 (x) × 4 (z); the street side is
// +Z. East-facing lots build the same layout rotated through the diagonal mirror (4 × 3 → 3 × 4).
import * as THREE from 'three';
import { PALETTE as P, mat, box, cylinder, plate, hedge, path, palm, fanPalm, broadleaf, shrub, umbrella, flowerbed, rng, pavingMat, woodMat, renderMat, grassTuft, waterMat } from '../lib/kit.js';
import { signOn, pottedPlant, bin, wallLamp } from '../lib/props.js';

export const POOL_VARIANTS = [
  { awning: [0x3f8d8a, P.ivory], lounge: P.coral, water: 0x3db4c6, name: 'LIDO' },
  { awning: [P.coral, P.ivory], lounge: 0x3f8d8a, water: 0x45bcc0, name: 'SPLASH' },
];

function lounger(parent, x, z, color, axis = 'z') {
  const L = axis === 'z' ? [0.07, 0.17] : [0.17, 0.07];
  box(parent, x, 0.02, z, L[0], 0.025, L[1], mat(P.white), 0.008);
  box(parent, x + 0.005, 0.045, z + 0.005, L[0] - 0.01, 0.012, L[1] - 0.01, mat(color, { rough: 0.9, tex: 'fabric' }), 0.004);
}

/** Built with width W along x and depth D along z (street at z = D). */
export function buildPool(group, variantIndex, W, D, seed) {
  const v = POOL_VARIANTS[variantIndex % POOL_VARIANTS.length];
  const random = rng(seed);
  plate(group, W, D, 0x86ad70);
  // Tiled deck.
  const deck = mat(0xf1ebde, { rough: 0.7, tex: 'poolTile' });
  box(group, 0.15, 0, 0.15, W - 0.3, 0.03, D - 0.3, deck);
  // Main lane pool with coping, lane ropes and ladders.
  const px0 = 0.35, pz0 = 0.5, pw = W - 0.95, pd = D * 0.48;
  box(group, px0 - 0.06, 0.03, pz0 - 0.06, pw + 0.12, 0.02, pd + 0.12, mat(P.ivory, { rough: 0.6 }));
  box(group, px0, 0.03, pz0, pw, 0.022, pd, mat(0x9fe0e6, { rough: 0.3, tex: 'poolTile', texScale: 0.6 }));
  box(group, px0, 0.045, pz0, pw, 0.012, pd, waterMat(v.water));
  const lanes = Math.max(3, Math.round(pw / 0.32));
  for (let i = 1; i < lanes; i += 1) {
    const x = px0 + (pw * i) / lanes;
    for (let k = 0; k < 14; k += 1) cylinder(group, x, 0.056, pz0 + 0.02 + (pd - 0.04) * k / 13, 0.012, 0.012, 0.012, mat(k % 3 ? P.white : 0xd84a4a, { rough: 0.5 }), 8);
  }
  for (const lx of [px0 + 0.1, px0 + pw - 0.15]) for (const dx of [0, 0.06]) {
    const rail = cylinder(group, lx + dx, 0.05, pz0 + pd + 0.02, 0.006, 0.006, 0.1, mat(0xdfe6e8, { metal: 0.85, rough: 0.2 }), 8);
    void rail;
  }
  // Diving board at the far end.
  box(group, px0 + pw / 2 - 0.05, 0.03, pz0 - 0.22, 0.1, 0.08, 0.08, mat(0xd8d2c6));
  box(group, px0 + pw / 2 - 0.035, 0.1, pz0 - 0.2, 0.07, 0.015, 0.3, mat(0x5fb0aa, { rough: 0.4 }));
  // Kids' pool: rounded, shallow and lighter.
  const kx = W - 0.38, kz = pz0 + pd * 0.35;
  cylinder(group, kx, 0.03, kz, 0.2, 0.21, 0.025, mat(P.ivory), 28);
  cylinder(group, kx, 0.035, kz, 0.17, 0.17, 0.025, waterMat(0x7fd6dc), 28);
  // Lifeguard chair.
  const chair = mat(P.white, { rough: 0.5 });
  for (const [dx, dz] of [[0, 0], [0.08, 0], [0, 0.08], [0.08, 0.08]]) box(group, px0 + pw + 0.08 + dx, 0.03, pz0 + pd * 0.6 + dz, 0.014, 0.28, 0.014, chair);
  box(group, px0 + pw + 0.07, 0.28, pz0 + pd * 0.6 - 0.01, 0.11, 0.02, 0.11, mat(0xd84a4a, { rough: 0.5 }));
  umbrella(group, px0 + pw + 0.12, pz0 + pd * 0.6 + 0.05, 0xd84a4a);
  // Loungers and umbrellas along the street-side deck.
  const lz = pz0 + pd + 0.15;
  for (let i = 0; i < Math.floor((W - 0.6) / 0.22); i += 1) {
    const x = 0.32 + i * 0.22;
    lounger(group, x, lz, v.lounge); lounger(group, x + 0.08, lz, v.lounge);
    if (i % 2 === 0) umbrella(group, x + 0.075, lz + 0.22, v.awning[0]);
  }
  // Cabana (changing rooms, kiosk) along the back with a striped awning and sign.
  const cz = 0.18;
  box(group, 0.2, 0.03, cz - 0.02, W - 0.4, 0.3, 0.22, renderMat(0xfaf6ee));
  for (let i = 0; i < 10; i += 1) box(group, 0.2 + (W - 0.4) * i / 10, 0.33, cz - 0.02, (W - 0.4) / 10, 0.04, 0.3, mat(v.awning[i % 2], { rough: 0.9, tex: 'fabric' }));
  for (let i = 0; i < 4; i += 1) box(group, 0.3 + i * (W - 0.6) / 4, 0.03, cz + 0.2, 0.12, 0.22, 0.012, mat(i % 2 ? v.awning[0] : 0x5f8fa8, { rough: 0.6 }));
  signOn(group, 'south', cz + 0.205, W / 2 - 0.25, 0.37, 0.5, 0.08, v.name, { bg: '#ffffff', fg: '#2a7f86', font: '800 72px Verdana, sans-serif' });
  wallLamp(group, 'south', cz + 0.2, 0.25, 0.22); wallLamp(group, 'south', cz + 0.2, W - 0.3, 0.22);
  // Entry path from the street with gate posts; hedge and tropical planting around the edge.
  path(group, W / 2 - 0.15, D - 0.2, 0.3, 0.2, P.paving);
  hedge(group, 0.03, D - 0.12, W / 2 - 0.2, 'x', { h: 0.13, w: 0.09 });
  hedge(group, W / 2 + 0.17, D - 0.12, W / 2 - 0.2, 'x', { h: 0.13, w: 0.09 });
  hedge(group, 0.03, 0.12, D - 0.3, 'z', { h: 0.13, w: 0.09 });
  hedge(group, W - 0.12, 0.12, D - 0.3, 'z', { h: 0.13, w: 0.09 });
  palm(group, 0.12, D - 0.35, random, { scale: 1.45 }); palm(group, W - 0.13, D - 0.45, random, { scale: 1.3 });
  palm(group, 0.13, 0.95, random, { scale: 1.35, lean: 0.3 }); fanPalm(group, W - 0.16, 1.25, random, { scale: 1.3 });
  broadleaf(group, W - 0.2, 0.2, random, { scale: 1.1, leaves: 'deep' });
  for (const [sx, sz] of [[0.14, 1.9], [W - 0.14, 2.2], [0.4, D - 0.2], [W - 0.45, D - 0.22]]) shrub(group, sx, sz, random, { scale: 1.2, flowers: random() < 0.6 ? 0xd94f8a : P.gold });
  flowerbed(group, 0.25, D - 0.42, 0.5, 0.14, random); flowerbed(group, W - 0.8, D - 0.42, 0.55, 0.14, random, [P.coral, P.gold]);
  for (let i = 0; i < 4; i += 1) pottedPlant(group, 0.3 + i * (W - 0.6) / 3, lz + 0.4, random, 1.2);
  bin(group, W / 2 + 0.25, D - 0.3);
  for (let i = 0; i < 6; i += 1) grassTuft(group, 0.08 + random() * 0.08, 1.2 + random() * 1.5, random);
  return group;
}

export function poolAssets() {
  return POOL_VARIANTS.flatMap((_, index) => [
    { id: `pool.v${index}.S`, kind: 'pool', variant: index, front: 'S', footprint: { w: 3, d: 4 }, build: (g) => buildPool(g, index, 3, 4, 6000 + index * 31) },
    { id: `pool.v${index}.E`, kind: 'pool', variant: index, front: 'E', footprint: { w: 3, d: 4 }, build: (g) => buildPool(g, index, 4, 3, 6100 + index * 31) },
  ]);
}
