// Shopping mall (6×5), Visual World 3.0B: a two-storey retail arcade with individual lettered shopfronts and
// awnings, a tall glazed atrium entrance with a canopy and a lit name sign, an upper gallery, rooftop plant and
// skylights, a paved plaza with fountain, planters and trees, a pylon sign, and a parking court with cars.
// Frontage W along +X, street at z = D. East-facing lots build W = 5, D = 6 and mirror (→ 6 × 5).
import * as THREE from 'three';
import { PALETTE as P, mat, box, cylinder, plate, shopfrontOn, awningOn, bandOn, windowOn, planter, broadleaf, palm, shrub, bench, flowerbed, umbrella, hedge, rng, flatRoof, renderMat, stoneMat, pavingMat, concreteMat, glass, sphere } from '../lib/kit.js';
import { signOn, pylonSign, car, CAR_COLORS, parkingBay, bin, bollard, bikeRack, pottedPlant, acUnit, wallLamp, sculpture } from '../lib/props.js';

const SHOPS = [
  { name: 'BAKERY', awning: [0xc8674a, P.ivory], bg: '#7a3b2a', fg: '#f6e3c0' },
  { name: 'SURF', awning: [0x3f8d8a, P.ivory], bg: '#2f5f5c', fg: '#f4f0e4' },
  { name: 'BOOKS', awning: [0x5f8fa8, P.ivory], bg: '#2c3e57', fg: '#f1c45f' },
  { name: 'GELATO', awning: [0xf4a6b8, P.ivory], bg: '#9c4a64', fg: '#ffffff' },
  { name: 'MARKET', awning: [0x6f9e5c, P.ivory], bg: '#34502c', fg: '#f6e3c0' },
  { name: 'STYLE', awning: [0x34433f, 0xe9dcc4], bg: '#1f2a2e', fg: '#e9dcc4' },
];
export const MALL_VARIANTS = [
  { wall: 0xf3ebdc, trim: 0xd9cbb0, accent: 0xc8674a, name: 'HARBOUR MALL', glass: 0x9fcbd6 },
  { wall: 0xeef0ea, trim: 0xcfd6d0, accent: 0x3f8d8a, name: 'LAGOON MALL', glass: 0xa7d3d6 },
];

export function buildMall(group, variantIndex, W, D, seed) {
  const v = MALL_VARIANTS[variantIndex % MALL_VARIANTS.length];
  const random = rng(seed);
  plate(group, W, D, 0x86ad70);
  // Plaza across the front, parking court on one side, service lane at the back.
  box(group, 0.1, 0, D - 1.25, W - 0.2, 0.014, 1.15, pavingMat(0xeee5d2));
  const parkW = 1.35;
  parkingBay(group, W - parkW - 0.1, 0.3, parkW, D - 1.65, 'z');
  // Building: two storeys, the arcade block plus a taller atrium in the middle.
  const bx0 = 0.25, bx1 = W - parkW - 0.25, bz0 = 0.35, bz1 = D - 1.3;
  const g1 = 0.56, g2 = 0.5, height = g1 + g2;
  box(group, bx0 - 0.03, 0, bz0 - 0.03, bx1 - bx0 + 0.06, 0.06, bz1 - bz0 + 0.06, stoneMat(0xd8cdb6));
  box(group, bx0, 0.05, bz0, bx1 - bx0, height - 0.05, bz1 - bz0, renderMat(v.wall));
  bandOn(group, 'south', bz1, bx0, bx1 - bx0, g1 - 0.02, { color: v.trim, h: 0.06, out: 0.05 });
  bandOn(group, 'east', bx1, bz0, bz1 - bz0, g1 - 0.02, { color: v.trim, h: 0.06, out: 0.05 });
  bandOn(group, 'south', bz1, bx0, bx1 - bx0, height - 0.04, { color: v.trim, h: 0.07, out: 0.05 });
  bandOn(group, 'east', bx1, bz0, bz1 - bz0, height - 0.04, { color: v.trim, h: 0.07, out: 0.05 });
  // Atrium: a glazed tower over the entrance.
  const ax0 = (bx0 + bx1) / 2 - 0.42, ax1 = ax0 + 0.84, atriumH = 1.32;
  box(group, ax0, 0.05, bz1 - 0.6, ax1 - ax0, atriumH, 0.7, renderMat(0xfaf6ee));
  for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1) {
    const pane = box(group, ax0 + 0.04 + c * 0.195, 0.1 + r * 0.3, bz1 + 0.1, 0.18, 0.28, 0.012, glass(v.glass));
    pane.userData.window = true; pane.userData.lit = r === 0 || (r + c) % 3 !== 0;
  }
  for (let c = 0; c <= 4; c += 1) box(group, ax0 + 0.03 + c * 0.195, 0.08, bz1 + 0.095, 0.015, atriumH - 0.05, 0.02, mat(P.charcoal, { metal: 0.4 }));
  box(group, ax0 - 0.04, atriumH + 0.05, bz1 - 0.64, ax1 - ax0 + 0.08, 0.06, 0.8, mat(v.accent, { rough: 0.5 }));
  signOn(group, 'south', bz1 + 0.16, ax0 + 0.02, atriumH - 0.08, ax1 - ax0 - 0.04, 0.13, v.name, { bg: '#ffffff', fg: v.accent === 0xc8674a ? '#b5533a' : '#2a7f86', font: '800 58px Verdana, sans-serif', frame: v.accent });
  // Entrance canopy.
  box(group, ax0 - 0.12, 0.42, bz1 + 0.1, ax1 - ax0 + 0.24, 0.03, 0.42, mat(P.charcoal, { rough: 0.4, metal: 0.3 }));
  for (const cx of [ax0 - 0.1, ax1 + 0.07]) box(group, cx, 0, bz1 + 0.47, 0.03, 0.42, 0.03, mat(P.charcoal, { metal: 0.4 }));
  // Shopfronts either side of the atrium, each with its own awning and lettered sign; upper gallery windows.
  const bays = [[bx0 + 0.05, ax0 - 0.05], [ax1 + 0.05, bx1 - 0.05]];
  let shopIndex = variantIndex * 2;
  for (const [from, to] of bays) {
    const count = Math.max(1, Math.round((to - from) / 0.62));
    const w = (to - from) / count;
    for (let i = 0; i < count; i += 1) {
      const shop = SHOPS[shopIndex % SHOPS.length]; shopIndex += 1;
      const u = from + i * w;
      shopfrontOn(group, 'south', bz1, u + 0.04, w - 0.08, g1 * 0.78, { frame: P.charcoal, lit: true });
      awningOn(group, 'south', bz1, u + 0.02, w - 0.04, g1 * 0.88, { colors: shop.awning, depth: 0.24, drop: 0.1, stripes: 8 });
      signOn(group, 'south', bz1, u + w * 0.12, g1 * 0.9, w * 0.76, 0.075, shop.name, { bg: shop.bg, fg: shop.fg });
      windowOn(group, 'south', bz1, u + 0.06, g1 + 0.1, w - 0.12, g2 * 0.55, { frame: P.charcoal, mullion: true, sill: false });
    }
  }
  // East side: shopfront facing the parking court plus gallery windows.
  for (let i = 0; i < 3; i += 1) {
    const u = bz0 + 0.15 + i * (bz1 - bz0 - 0.3) / 3, w = (bz1 - bz0 - 0.3) / 3;
    shopfrontOn(group, 'east', bx1, u + 0.04, w - 0.08, g1 * 0.78, { frame: P.charcoal, lit: true });
    windowOn(group, 'east', bx1, u + 0.06, g1 + 0.1, w - 0.12, g2 * 0.55, { frame: P.charcoal, sill: false });
    if (i === 1) awningOn(group, 'east', bx1, u + 0.02, w - 0.04, g1 * 0.88, { colors: [v.accent, P.ivory], depth: 0.22, drop: 0.1, stripes: 7 });
  }
  wallLamp(group, 'south', bz1, bx0 + 0.02, g1 * 0.7); wallLamp(group, 'south', bz1, bx1 - 0.06, g1 * 0.7);
  // Roof: parapet, skylights and plant.
  flatRoof(group, bx0, bz0, bx1, bz1, height, { color: v.trim, deck: 0xb3b1ab });
  for (let i = 0; i < 3; i += 1) {
    const sx = bx0 + 0.35 + i * 0.6;
    box(group, sx, height + 0.04, bz0 + 0.3, 0.36, 0.08, 0.5, mat(P.ivory));
    const sky = box(group, sx + 0.03, height + 0.12, bz0 + 0.33, 0.3, 0.012, 0.44, glass(0x9fc6d2)); sky.userData.window = true;
  }
  for (const [ux, uz] of [[bx1 - 0.7, bz0 + 0.3], [bx1 - 0.4, bz0 + 0.3], [bx1 - 0.55, bz0 + 0.7]]) { box(group, ux, height + 0.04, uz, 0.22, 0.14, 0.2, mat(0xd8d6d0, { rough: 0.6 }), 0.01); cylinder(group, ux + 0.11, height + 0.18, uz + 0.1, 0.06, 0.06, 0.01, mat(0x4a5258), 16); }
  acUnit(group, 'east', bx1, bz0 + 0.1, height - 0.2);
  // Solar arrays and a sedum green-roof strip break up the big roof.
  for (let r = 0; r < 2; r += 1) for (let c = 0; c < 4; c += 1) {
    const panel = box(group, bx0 + 0.25 + c * 0.36, height + 0.08, bz0 + 1.0 + r * 0.42, 0.32, 0.02, 0.34, mat(0x2f4a66, { rough: 0.25, metal: 0.4 }));
    panel.rotation.x = -0.3;
    box(group, bx0 + 0.27 + c * 0.36, height + 0.04, bz0 + 1.12 + r * 0.42, 0.02, 0.05, 0.02, mat(0x9aa0a6));
  }
  box(group, bx0 + 0.1, height + 0.04, bz1 - 0.42, ax0 - bx0 - 0.2, 0.025, 0.3, mat(0x7f9f5a, { rough: 1, tex: 'grass', texScale: 0.5 }));
  box(group, ax1 + 0.1, height + 0.04, bz1 - 0.42, bx1 - ax1 - 0.2, 0.025, 0.3, mat(0x7f9f5a, { rough: 1, tex: 'grass', texScale: 0.5 }));
  // Plaza: fountain, planters with trees, benches, bollards, a sculpture, bikes.
  const fx = (bx0 + bx1) / 2, fz = D - 0.62;
  cylinder(group, fx, 0, fz, 0.32, 0.34, 0.07, stoneMat(0xe0d6c2), 32);
  cylinder(group, fx, 0.05, fz, 0.28, 0.28, 0.03, new THREE.MeshPhysicalMaterial({ color: 0x4fbac6, roughness: 0.05, clearcoat: 1 }), 32);
  cylinder(group, fx, 0.05, fz, 0.05, 0.06, 0.2, mat(P.ivory), 12);
  sphere(group, fx, 0.3, fz, 0.05, new THREE.MeshPhysicalMaterial({ color: 0xe6f7f7, transparent: true, opacity: 0.75 }), 2);
  for (const tx of [bx0 + 0.25, fx - 0.85, fx + 0.85, bx1 - 0.2]) {
    box(group, tx - 0.14, 0, D - 0.52, 0.28, 0.08, 0.28, stoneMat(0xd8cdb6), 0.01);
    broadleaf(group, tx, D - 0.38, random, { scale: 1.05, leaves: tx < fx ? 'round' : 'lime' });
  }
  for (const bxp of [fx - 0.5, fx + 0.38]) bench(group, bxp, D - 0.28, 'x');
  for (let i = 0; i < 7; i += 1) bollard(group, 0.3 + i * (W - parkW - 0.6) / 6, D - 0.1);
  for (const px of [ax0 - 0.2, ax1 + 0.15]) pottedPlant(group, px, bz1 + 0.6, random, 1.4);
  bikeRack(group, bx0 + 0.15, D - 0.95, 4, random);
  bin(group, fx + 0.45, D - 0.95); bin(group, fx - 0.45, D - 0.95);
  for (const ux of [bx0 + 0.6, bx1 - 0.55]) umbrella(group, ux, D - 1.0, ux < fx ? 0xc8674a : 0x3f8d8a);
  // Parking court: cars in bays, a pylon sign, hedges and trees on the edges.
  const cars = Math.floor((D - 1.65) / 0.26);
  for (let i = 0; i < cars; i += 1) if (i % 3 !== 1) car(group, W - parkW + 0.25, 0.45 + i * 0.26, Math.PI / 2 * 0 + Math.PI, CAR_COLORS[(i * 3 + variantIndex) % CAR_COLORS.length], random);
  for (let i = 0; i < cars; i += 1) if (i % 4 !== 2) car(group, W - 0.4, 0.45 + i * 0.26, 0, CAR_COLORS[(i * 5 + 2 + variantIndex) % CAR_COLORS.length], random);
  pylonSign(group, W - 0.25, D - 0.3, 0.9, 'MALL', { bg: '#ffffff', fg: '#b5533a', font: '900 84px Verdana, sans-serif', frame: v.accent });
  hedge(group, W - parkW - 0.16, 0.3, D - 1.7, 'z', { h: 0.1, w: 0.08 });
  hedge(group, W - 0.12, 0.2, D - 1.6, 'z', { h: 0.1, w: 0.08 });
  palm(group, W - 0.15, D - 1.2, random, { scale: 1.35 }); palm(group, W - parkW - 0.1, D - 1.25, random, { scale: 1.2 });
  broadleaf(group, 0.15, 0.2, random, { scale: 1.2, leaves: 'deep' }); broadleaf(group, bx1 + 0.05, 0.15, random, { scale: 1.1, leaves: 'round' });
  flowerbed(group, 0.12, D - 1.2, 0.5, 0.14, random); flowerbed(group, bx1 - 0.6, D - 1.2, 0.5, 0.14, random, [P.coral, P.gold]);
  shrub(group, 0.12, 0.9, random, { scale: 1.2, flowers: P.coral }); shrub(group, 0.12, 1.6, random, { scale: 1.3 });
  sculpture(group, bx0 + 0.6, D - 0.75, v.accent);
  return group;
}

export function mallAssets() {
  return MALL_VARIANTS.flatMap((_, index) => [
    { id: `mall.v${index}.S`, kind: 'mall', variant: index, front: 'S', footprint: { w: 6, d: 5 }, build: (g) => buildMall(g, index, 6, 5, 7000 + index * 37) },
    { id: `mall.v${index}.E`, kind: 'mall', variant: index, front: 'E', footprint: { w: 6, d: 5 }, build: (g) => buildMall(g, index, 5, 6, 7100 + index * 37) },
  ]);
}
