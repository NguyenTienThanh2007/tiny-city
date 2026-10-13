// Clubhouse (3×3), Visual World 3.0B: a modern community pavilion with floor-to-ceiling glazing, timber-clad
// service volume, a thin cantilevered roof with deep overhangs and a roof garden, a lettered sign, and an
// outdoor leisure terrace (deck, tables, loungers, fire pit) in a planted garden. Built facing south; mirrored
// for east-facing lots.
import * as THREE from 'three';
import { PALETTE as P, mat, box, cylinder, plate, windowOn, doorOn, hedge, flowerbed, path, palm, broadleaf, shrub, umbrella, planter, rng, renderMat, woodMat, stoneMat, pavingMat, glass, grassTuft, fanPalm } from '../lib/kit.js';
import { wallLamp, signOn, pottedPlant, picnicTable, bin, bikeRack } from '../lib/props.js';

export const CLUBHOUSE_VARIANTS = [
  { clad: 0xa8754c, roof: 0xf4f0e8, accent: 0x3f8d8a, sign: ['#2f4a3a', '#f6d27a'], name: 'GARDEN CLUB' },
  { clad: 0x8e6a4b, roof: 0xece6da, accent: 0xd8735b, sign: ['#3a2f2a', '#f8e2c8'], name: 'LAGOON CLUB' },
  { clad: 0xc0905e, roof: 0xf6f3ec, accent: 0x5f8fa8, sign: ['#22384a', '#f1c45f'], name: 'COVE CLUB' },
];

function lounger(parent, x, z, color) {
  box(parent, x, 0.02, z, 0.16, 0.025, 0.07, mat(P.ivory), 0.008);
  box(parent, x + 0.02, 0.045, z + 0.005, 0.12, 0.012, 0.06, mat(color, { rough: 0.9, tex: 'fabric' }), 0.004);
}

export function buildClubhouse(group, variantIndex, seed) {
  const v = CLUBHOUSE_VARIANTS[variantIndex % CLUBHOUSE_VARIANTS.length];
  const random = rng(seed);
  plate(group, 3, 3, 0x86ad70);
  // Entry path and a wide terrace on the street side.
  path(group, 1.2, 2.2, 0.3, 0.78, P.paving);
  box(group, 0.2, 0, 1.85, 2.6, 0.03, 0.42, woodMat(0xb88a5e));
  // Building: glass pavilion (x 0.3–2.1) plus a timber service block (x 2.1–2.7).
  const z0 = 0.45, z1 = 1.85, h = 0.62;
  box(group, 0.28, 0, z0 - 0.02, 2.44, 0.05, z1 - z0 + 0.04, stoneMat(0xe0d6c2));
  box(group, 0.3, 0.05, z0, 1.8, h - 0.05, z1 - z0 - 0.2, renderMat(0xf6f2ea));
  // Floor-to-ceiling glazing across the front and east of the pavilion, with slim mullions.
  const glazing = glass(0xa7d0d8);
  for (let i = 0; i < 6; i += 1) {
    const pane = box(group, 0.33 + i * 0.29, 0.06, z1 - 0.21, 0.27, h - 0.1, 0.012, glazing);
    pane.userData.window = true; pane.userData.lit = i !== 2;
    box(group, 0.31 + i * 0.29, 0.05, z1 - 0.215, 0.02, h - 0.08, 0.02, mat(P.charcoal, { metal: 0.4, rough: 0.4 }));
  }
  box(group, 0.3, 0.05, z1 - 0.215, 1.8, 0.02, 0.02, mat(P.charcoal, { metal: 0.4 }));
  // Interior hints behind the glass: a long lounge sofa and pendant lights.
  box(group, 0.5, 0.06, z1 - 0.5, 1.2, 0.08, 0.14, mat(v.accent, { rough: 0.9, tex: 'fabric' }));
  for (let i = 0; i < 4; i += 1) { const lamp = cylinder(group, 0.6 + i * 0.35, h - 0.16, z1 - 0.4, 0.04, 0.02, 0.05, mat(0xfff0c8, { emissive: 0x2a2010 }), 12); lamp.userData.lamp = true; }
  box(group, 2.1, 0.05, z0, 0.6, h - 0.05, z1 - z0, woodMat(v.clad));
  // Vertical timber battens on the service block.
  for (let i = 0; i < 12; i += 1) box(group, 2.12 + i * 0.048, 0.05, z1 - 0.005, 0.02, h - 0.05, 0.02, mat(new THREE.Color(v.clad).multiplyScalar(0.85).getHex(), { rough: 0.8 }));
  doorOn(group, 'south', z1 - 0.21, 1.14, 0.3, 0.44, { color: 0x45545a, frame: P.charcoal, glazed: true });
  windowOn(group, 'east', 2.7, 0.7, 0.16, 0.3, 0.3, { frame: P.charcoal });
  windowOn(group, 'east', 2.7, 1.2, 0.16, 0.3, 0.3, { frame: P.charcoal });
  wallLamp(group, 'south', z1, 2.25, 0.4); wallLamp(group, 'south', z1, 2.55, 0.4);
  // Thin cantilevered roof with deep overhang, a roof garden and a raised clerestory over the lounge.
  box(group, 0.1, h, z0 - 0.15, 2.8, 0.06, z1 - z0 + 0.45, mat(v.roof, { rough: 0.6 }));
  // Sedum green roof over most of the slab, edged in gravel.
  box(group, 0.2, h + 0.06, z0 - 0.05, 2.6, 0.02, z1 - z0 + 0.25, mat(0xb9b4aa, { rough: 1, tex: 'concrete', texScale: 0.4 }));
  box(group, 0.28, h + 0.075, z0 + 0.02, 2.44, 0.02, z1 - z0 + 0.1, mat(0x86a85f, { rough: 1, tex: 'grass', texScale: 0.5 }));
  box(group, 0.1, h + 0.06, z1 + 0.27, 2.8, 0.015, 0.03, mat(v.accent, { rough: 0.5 }));
  box(group, 0.7, h + 0.06, z0 + 0.15, 1.0, 0.2, 0.7, renderMat(0xf6f2ea));
  for (let i = 0; i < 4; i += 1) { const pane = box(group, 0.74 + i * 0.24, h + 0.09, z0 + 0.85, 0.2, 0.14, 0.01, glazing); pane.userData.window = true; pane.userData.lit = true; }
  box(group, 0.65, h + 0.26, z0 + 0.1, 1.1, 0.04, 0.8, mat(v.roof));
  for (const [px, pz] of [[1.9, 0.6], [2.2, 1.2], [0.3, 0.6]]) planter(group, px, pz, 0.35, 0.22, random, { h: 0.06 });
  for (let i = 0; i < 6; i += 1) grassTuft(group, 1.85 + random() * 0.8, z0 + random() * 1.2, random, { scale: 1 });
  signOn(group, 'south', z1 + 0.3, 2.12, h + 0.08, 0.6, 0.1, v.name, { bg: v.sign[0], fg: v.sign[1], font: '700 58px Georgia, serif' });
  // Terrace: tables with umbrellas, loungers, a fire pit and planters.
  for (const [ux, color] of [[0.45, v.accent], [0.95, P.coral], [2.2, v.accent]]) umbrella(group, ux, 2.05, color);
  lounger(group, 1.55, 1.95, P.ivory); lounger(group, 1.55, 2.08, P.ivory);
  cylinder(group, 1.9, 0.03, 2.08, 0.08, 0.09, 0.05, stoneMat(0xc9bfa8), 16);
  const fire = cylinder(group, 1.9, 0.07, 2.08, 0.05, 0.05, 0.015, mat(0xffb15a, { emissive: 0x663300 }), 12); fire.userData.lamp = true;
  for (const ux of [0.25, 2.6]) pottedPlant(group, ux, 2.2, random, 1.3);
  // Garden: lawn, palms, flowering shrubs, a picnic corner and hedges along the edges.
  palm(group, 0.15, 2.6, random, { scale: 1.4 }); palm(group, 2.85, 2.55, random, { scale: 1.25 }); fanPalm(group, 2.6, 2.85, random, { scale: 1.2 });
  broadleaf(group, 0.25, 0.25, random, { scale: 1.25, leaves: 'round' }); broadleaf(group, 2.8, 0.3, random, { scale: 1.15, leaves: 'olive' });
  flowerbed(group, 0.35, 2.4, 0.7, 0.26, random); flowerbed(group, 1.65, 2.4, 0.9, 0.26, random, [0xd94f8a, P.gold, P.ivory]);
  for (const [sx, sz] of [[0.12, 1.2], [2.88, 1.4], [1.0, 2.85], [1.75, 2.85]]) shrub(group, sx, sz, random, { scale: 1.3, flowers: random() < 0.5 ? P.coral : null });
  hedge(group, 0.04, 0.04, 2.92, 'x', { h: 0.13, w: 0.09 });
  hedge(group, 0.04, 0.12, 2.4, 'z', { h: 0.12, w: 0.08 }); hedge(group, 2.88, 0.12, 2.0, 'z', { h: 0.12, w: 0.08 });
  picnicTable(group, 2.5, 2.55); bin(group, 1.08, 2.85); bikeRack(group, 1.55, 2.62, 3, random);
  return group;
}

export function clubhouseAssets() {
  return CLUBHOUSE_VARIANTS.flatMap((_, index) => ['S', 'E'].map((front) => ({
    id: `clubhouse.v${index}.${front}`, kind: 'clubhouse', variant: index, front, footprint: { w: 3, d: 3 },
    build: (g) => buildClubhouse(g, index, 5000 + index * 29),
  })));
}
