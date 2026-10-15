// Phase 7 entertainment venues (Classic Coastal): café & restaurant (2 variants), shopping street, night market,
// cinema, music club, concert stage, performance plaza and amusement park. Each is built facing south with its
// street at z = D; east-facing lots build with W and D swapped and are mirrored (see bake-page.js).
// Every venue keeps an open, readable area at the front (terrace, pavement, forecourt, lawn or aisles) where the
// renderer draws the residents who are really visiting (src/game/venueCrowd.ts holds those spots).
import * as THREE from 'three';
import {
  PALETTE as P, mat, box, cylinder, sphere, plate, roof, shopfrontOn, awningOn, bandOn, windowOn, doorOn, flatRoof, planter, broadleaf, palm,
  shrub, bench, umbrella, hedge, rng, renderMat, stoneMat, pavingMat, woodMat, brickMat, glass, streetLamp, flowerbed, path, fanPalm,
} from '../lib/kit.js';
import { signOn, wallLamp, pottedPlant, bin, bollard, bikeRack, picnicTable, kiosk, pergola } from '../lib/props.js';

const enable = (mesh) => { mesh.castShadow = true; mesh.receiveShadow = true; return mesh; };
const glowing = (mesh, color) => { mesh.userData.glow = color; return mesh; };

/** A café table with two chairs. */
function cafeTable(parent, x, z, color) {
  cylinder(parent, x, 0, z, 0.008, 0.012, 0.11, mat(P.charcoal, { metal: 0.4 }), 6);
  cylinder(parent, x, 0.11, z, 0.055, 0.055, 0.012, mat(P.ivory), 14);
  for (const dx of [-0.085, 0.085]) {
    box(parent, x + dx - 0.025, 0.06, z - 0.025, 0.05, 0.01, 0.05, mat(color, { rough: 0.7 }));
    box(parent, x + dx + (dx < 0 ? -0.025 : 0.02), 0.06, z - 0.025, 0.006, 0.07, 0.05, mat(color, { rough: 0.7 }));
  }
}
/** A string of bulbs between two points (each bulb glows at night). */
function lights(parent, a, b, count, color = 0xffd58a, sag = 0.05) {
  const wire = mat(P.charcoal, { rough: 0.5 });
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const y = a.y + (b.y - a.y) * t - Math.sin(Math.PI * t) * sag;
    const bulb = sphere(parent, a.x + (b.x - a.x) * t, y, a.z + (b.z - a.z) * t, 0.012, mat(color, { rough: 0.3, emissive: 0x332200 }), 1);
    glowing(bulb, color);
    if (i < count) {
      const t2 = (i + 0.5) / count;
      box(parent, a.x + (b.x - a.x) * t2 - 0.002, a.y + (b.y - a.y) * t2 - Math.sin(Math.PI * t2) * sag, a.z + (b.z - a.z) * t2 - 0.002, 0.004, 0.004, 0.004, wire);
    }
  }
}
/** A paper lantern (glows at night). */
function lantern(parent, x, y, z, color) {
  glowing(sphere(parent, x, y, z, 0.026, mat(color, { rough: 0.6, emissive: 0x220a00 }), 1), color);
  box(parent, x - 0.004, y + 0.024, z - 0.004, 0.008, 0.012, 0.008, mat(P.charcoal));
}

// ─── Café & restaurant (2×2) ──────────────────────────────────────────────────────────────────────────────────────
export const CAFE_VARIANTS = [
  { name: 'CORNER CAFÉ', wall: 0xf6ead4, trim: 0x3f8d8a, awning: [0x3f8d8a, P.ivory], chairs: 0x3f8d8a, sign: ['#2f5f5c', '#f6e3c0'] },
  { name: 'GARDEN BISTRO', wall: 0xf1dfc6, trim: 0xc8674a, awning: [0xc8674a, P.ivory], chairs: 0xc8674a, sign: ['#6e2f22', '#f6e3c0'] },
];
export function buildCafe(group, variantIndex, W, D, seed) {
  const v = CAFE_VARIANTS[variantIndex % CAFE_VARIANTS.length];
  const random = rng(seed);
  plate(group, W, D, 0x86ad70);
  // Terrace paving across the front; the café at the back.
  box(group, 0.05, 0, D - 0.85, W - 0.1, 0.014, 0.8, pavingMat(0xeadfc9));
  const x0 = 0.15, x1 = W - 0.15, z0 = 0.15, z1 = D - 0.95, h = 0.5;
  box(group, x0 - 0.02, 0, z0 - 0.02, x1 - x0 + 0.04, 0.05, z1 - z0 + 0.04, stoneMat(0xd8cdb6));
  box(group, x0, 0.05, z0, x1 - x0, h - 0.05, z1 - z0, renderMat(v.wall));
  shopfrontOn(group, 'south', z1, x0 + 0.08, (x1 - x0) * 0.62, h * 0.72, { frame: P.charcoal, lit: true });
  doorOn(group, 'south', z1, x1 - 0.42, 0.22, h * 0.68, { color: v.trim, frame: P.charcoal, glazed: true });
  shopfrontOn(group, 'east', x1, z0 + 0.1, (z1 - z0) - 0.2, h * 0.72, { frame: P.charcoal, lit: true });
  bandOn(group, 'south', z1, x0, x1 - x0, h - 0.06, { color: v.trim, h: 0.05 });
  bandOn(group, 'east', x1, z0, z1 - z0, h - 0.06, { color: v.trim, h: 0.05 });
  // Interior hints: a counter and pendant lamps behind the glass.
  box(group, x0 + 0.15, 0.05, z1 - 0.18, (x1 - x0) * 0.5, 0.11, 0.08, woodMat(P.walnut));
  for (let i = 0; i < 3; i += 1) { const lamp = sphere(group, x0 + 0.3 + i * 0.32, h - 0.12, z1 - 0.2, 0.03, mat(0xfff0c8, { emissive: 0x2a2010 }), 1); lamp.userData.lamp = true; }
  flatRoof(group, x0, z0, x1, z1, h, { color: v.wall, deck: 0xb5b2aa });
  box(group, x0 + 0.2, h + 0.02, z0 + 0.15, 0.3, 0.12, 0.22, mat(0xd8d6d0), 0.01);
  signOn(group, 'south', z1 + 0.01, x0 + 0.1, h - 0.005, (x1 - x0) - 0.2, 0.09, v.name, { bg: v.sign[0], fg: v.sign[1], font: '700 60px Georgia, serif' });
  wallLamp(group, 'south', z1, x0 + 0.02, h * 0.7); wallLamp(group, 'east', x1, z1 - 0.1, h * 0.7);
  if (variantIndex === 0) {
    awningOn(group, 'south', z1, x0 + 0.04, (x1 - x0) - 0.08, h * 0.82, { colors: v.awning, depth: 0.3, drop: 0.1, stripes: 10 });
    for (const [tx, tz] of [[0.42, D - 0.55], [1.0, D - 0.42], [1.55, D - 0.58]]) { cafeTable(group, tx, tz, v.chairs); }
    umbrella(group, 0.42, D - 0.55, v.trim); umbrella(group, 1.55, D - 0.58, P.coral);
    for (const px of [0.1, W - 0.15]) planter(group, px, D - 0.25, 0.1, 0.2, random, { h: 0.07 });
  } else {
    // Bistro: a planted pergola over the terrace with string lights and a wood-fired oven.
    pergola(group, 0.12, D - 0.88, W - 0.24, 0.78, 0.34, P.walnut, random);
    lights(group, new THREE.Vector3(0.14, 0.33, D - 0.86), new THREE.Vector3(W - 0.14, 0.33, D - 0.14), 9);
    lights(group, new THREE.Vector3(0.14, 0.33, D - 0.14), new THREE.Vector3(W - 0.14, 0.33, D - 0.86), 9);
    for (const [tx, tz] of [[0.45, D - 0.6], [1.05, D - 0.35], [1.5, D - 0.62]]) cafeTable(group, tx, tz, v.chairs);
    box(group, x1 - 0.05, 0, D - 1.0, 0.2, 0.16, 0.16, brickMat(0xb86a4a), 0.02);
    sphere(group, x1 + 0.05, 0.17, D - 0.92, 0.07, brickMat(0xc0714f), 1);
    const fire = box(group, x1 + 0.03, 0.06, D - 0.84, 0.05, 0.04, 0.005, mat(0xffa040, { emissive: 0x552200 })); fire.userData.lamp = true;
  }
  broadleaf(group, 0.08, 0.1, random, { scale: 0.85, leaves: 'round' });
  pottedPlant(group, x1 + 0.06, z1 + 0.06, random, 1.2);
  return group;
}

// ─── Shopping street (4×2) ────────────────────────────────────────────────────────────────────────────────────────
const SHOPS = [
  { name: 'BOUTIQUE', awning: [0x34433f, 0xe9dcc4], bg: '#1f2a2e', fg: '#e9dcc4', wall: 0xf3ebdc },
  { name: 'FLOWERS', awning: [0xf4a6b8, P.ivory], bg: '#9c4a64', fg: '#ffffff', wall: 0xf6e6dc },
  { name: 'BOOKS', awning: [0x5f8fa8, P.ivory], bg: '#2c3e57', fg: '#f1c45f', wall: 0xe8eef0 },
  { name: 'SHOES', awning: [0xc8674a, P.ivory], bg: '#7a3b2a', fg: '#f6e3c0', wall: 0xf1dfc6 },
  { name: 'GIFTS', awning: [0x6f9e5c, P.ivory], bg: '#34502c', fg: '#f6e3c0', wall: 0xeef0e2 },
];
export function buildShops(group, W, D, seed) {
  const random = rng(seed);
  plate(group, W, D, 0x86ad70);
  // Wide pavement along the front; a row of two-storey shop units behind it.
  box(group, 0.02, 0, D - 0.75, W - 0.04, 0.014, 0.73, pavingMat(0xece3d0));
  const units = Math.max(2, Math.round(W / 1));
  const z0 = 0.12, z1 = D - 0.8, uw = (W - 0.2) / units;
  for (let i = 0; i < units; i += 1) {
    const shop = SHOPS[i % SHOPS.length];
    const x0 = 0.1 + i * uw, h = i % 2 === 0 ? 0.78 : 0.7;
    box(group, x0, 0, z0, uw - 0.01, h, z1 - z0, renderMat(shop.wall));
    shopfrontOn(group, 'south', z1, x0 + 0.06, uw - 0.13, 0.36, { frame: P.charcoal, lit: true });
    awningOn(group, 'south', z1, x0 + 0.04, uw - 0.09, 0.42, { colors: shop.awning, depth: 0.22, drop: 0.08, stripes: 7 });
    signOn(group, 'south', z1, x0 + uw * 0.12, 0.45, uw * 0.74, 0.07, shop.name, { bg: shop.bg, fg: shop.fg, font: '800 54px Verdana, sans-serif' });
    windowOn(group, 'south', z1, x0 + 0.1, 0.55, uw * 0.32, 0.14, { frame: P.white, sill: true });
    windowOn(group, 'south', z1, x0 + uw * 0.55, 0.55, uw * 0.32, 0.14, { frame: P.white, sill: true });
    // Gabled or flat roof per unit for a lively skyline.
    if (i % 2 === 0) roof(group, { x0: x0 - 0.02, z0: z0 - 0.02, x1: x0 + uw + 0.01, z1: z1 + 0.04, y: h, rise: 0.22, color: i % 4 === 0 ? P.roofTerracotta : P.roofSlate, ridge: 'z', hip: false, gableColor: shop.wall, tex: i % 4 === 0 ? 'roofTile' : 'slate' });
    else flatRoof(group, x0, z0, x0 + uw - 0.01, z1, h, { color: shop.wall, deck: 0xb5b2aa });
  }
  shopfrontOn(group, 'east', W - 0.1, z0 + 0.1, z1 - z0 - 0.2, 0.36, { frame: P.charcoal, lit: true });
  // Street furniture on the pavement: lamps, benches, planters with trees, bikes and a bin.
  for (let i = 0; i <= units; i += 2) streetLamp(group, 0.12 + i * uw, D - 0.12, { height: 0.5 });
  for (let i = 0; i < units; i += 2) bench(group, 0.1 + uw * (i + 0.5), D - 0.3, 'x');
  for (let i = 1; i < units; i += 2) { box(group, 0.1 + uw * (i + 0.5) - 0.1, 0, D - 0.38, 0.2, 0.07, 0.2, stoneMat(0xd8cdb6), 0.01); broadleaf(group, 0.1 + uw * (i + 0.5), D - 0.28, random, { scale: 0.8, leaves: 'lime' }); }
  bikeRack(group, W - 0.45, D - 0.55, 3, random); bin(group, 0.3, D - 0.58);
  return group;
}

// ─── Night market (4×3) ───────────────────────────────────────────────────────────────────────────────────────────
const STALLS = [[0xc8674a, P.ivory], [P.gold, 0xc8674a], [0x3f8d8a, P.ivory], [0xd94f8a, P.ivory], [0x6f9e5c, P.gold]];
function stall(parent, x, z, w, colors, random) {
  const wood = woodMat(0xb88a5e);
  box(parent, x, 0, z, w, 0.12, 0.2, wood, 0.01);
  box(parent, x + 0.01, 0.12, z + 0.01, w - 0.02, 0.012, 0.18, mat(P.ivory));
  for (const px of [x, x + w - 0.02]) for (const pz of [z, z + 0.2]) box(parent, px, 0, pz, 0.02, 0.32, 0.02, mat(P.charcoal, { metal: 0.3 }));
  const stripes = Math.max(3, Math.round(w / 0.06));
  for (let i = 0; i < stripes; i += 1) {
    const strip = box(parent, x - 0.02 + i * (w + 0.04) / stripes, 0.32, z - 0.03, (w + 0.04) / stripes, 0.012, 0.28, mat(colors[i % 2], { rough: 0.9 }));
    strip.rotation.x = -0.18;
  }
  // Goods on the counter (fruit, bowls, crafts) and a lit hanging bulb.
  for (let i = 0; i < Math.round(w / 0.07); i += 1) sphere(parent, x + 0.05 + i * 0.07, 0.15, z + 0.07 + (i % 2) * 0.06, 0.022, mat([P.coral, P.gold, 0x7fae69, P.terracotta][(i + Math.floor(random() * 4)) % 4], { rough: 0.6 }), 1);
  lantern(parent, x + w / 2, 0.26, z + 0.12, 0xffc366);
}
export function buildMarket(group, W, D, seed) {
  const random = rng(seed);
  plate(group, W, D, 0x8eaf74);
  box(group, 0.05, 0, 0.05, W - 0.1, 0.014, D - 0.1, mat(0xd8c8a8, { rough: 1, tex: 'cobble', texScale: 0.6 }));
  // Stalls along the back and the east side; a seating court with tables in the middle-front.
  const back = Math.max(2, Math.floor((W - 0.3) / 0.62));
  for (let i = 0; i < back; i += 1) stall(group, 0.15 + i * (W - 0.3) / back, 0.15, (W - 0.3) / back - 0.08, STALLS[i % STALLS.length], random);
  const side = Math.max(1, Math.floor((D - 1.2) / 0.62));
  const east = new THREE.Group(); east.position.set(W - 0.12, 0, 0.75); east.rotation.y = Math.PI / 2; group.add(east);
  for (let i = 0; i < side; i += 1) stall(east, -(i + 1) * (D - 1.2) / side, -0.2, (D - 1.2) / side - 0.08, STALLS[(i + 3) % STALLS.length], random);
  // Food truck by the entrance.
  box(group, 0.12, 0.05, D - 0.75, 0.55, 0.26, 0.26, mat(0xf3ede0, { rough: 0.5 }), 0.03);
  box(group, 0.14, 0.18, D - 0.495, 0.36, 0.08, 0.01, glass(0xbfdde2)).userData.window = true;
  box(group, 0.1, 0.31, D - 0.77, 0.6, 0.03, 0.32, mat(0xc8674a, { rough: 0.6 }));
  for (const wx of [0.22, 0.58]) cylinder(group, wx, 0.0, D - 0.48, 0.05, 0.05, 0.03, mat(P.charcoal), 12).rotation.x = Math.PI / 2;
  signOn(group, 'south', D - 0.48, 0.17, 0.28, 0.3, 0.05, 'NOODLES', { bg: '#7a3b2a', fg: '#f6e3c0', font: '800 52px Verdana, sans-serif' });
  // Seating court: picnic tables under lantern strings strung between posts.
  for (const [tx, tz] of [[1.2, 1.25], [2.0, 1.35], [1.55, 1.85], [2.4, 1.95]]) if (tx < W - 0.6 && tz < D - 0.6) picnicTable(group, tx, tz);
  const posts = [[0.9, 0.95], [W - 0.85, 0.95], [0.9, D - 0.45], [W - 0.85, D - 0.45]];
  for (const [px, pz] of posts) box(group, px, 0, pz, 0.025, 0.42, 0.025, woodMat(P.walnut));
  const colors = [0xff7a59, 0xffc366, 0xff5e8a, 0x7fd0c6];
  for (const [a, b] of [[0, 3], [1, 2], [0, 1], [2, 3]]) {
    const A = new THREE.Vector3(posts[a][0] + 0.012, 0.42, posts[a][1] + 0.012), B = new THREE.Vector3(posts[b][0] + 0.012, 0.42, posts[b][1] + 0.012);
    const n = Math.round(A.distanceTo(B) / 0.14);
    for (let i = 1; i < n; i += 1) { const t = i / n; lantern(group, A.x + (B.x - A.x) * t, 0.42 - Math.sin(Math.PI * t) * 0.07, A.z + (B.z - A.z) * t, colors[i % colors.length]); }
  }
  // Entrance arch with a lettered sign over the gap in the front.
  const ax = W / 2 - 0.45;
  for (const px of [ax, ax + 0.88]) box(group, px, 0, D - 0.1, 0.04, 0.5, 0.04, mat(0xc8674a, { rough: 0.5 }));
  box(group, ax - 0.03, 0.5, D - 0.12, 0.98, 0.06, 0.08, mat(0xc8674a, { rough: 0.5 }));
  signOn(group, 'south', D - 0.035, ax + 0.06, 0.505, 0.8, 0.05, 'NIGHT MARKET', { bg: '#2a1e1a', fg: '#ffc366', font: '800 50px Verdana, sans-serif' });
  palm(group, 0.12, D - 0.1, random, { scale: 1.1 }); palm(group, W - 0.12, D - 0.12, random, { scale: 1.2 });
  bin(group, ax - 0.15, D - 0.2); bin(group, ax + 1.05, D - 0.2);
  return group;
}

// ─── Cinema (3×3) ─────────────────────────────────────────────────────────────────────────────────────────────────
export function buildCinema(group, W, D, seed) {
  const random = rng(seed);
  plate(group, W, D, 0x86ad70);
  box(group, 0.05, 0, D - 0.95, W - 0.1, 0.014, 0.9, pavingMat(0xe9e0cc));
  const x0 = 0.18, x1 = W - 0.18, z0 = 0.15, z1 = D - 1.0, h = 0.86;
  box(group, x0 - 0.02, 0, z0 - 0.02, x1 - x0 + 0.04, 0.06, z1 - z0 + 0.04, stoneMat(0xd8cdb6));
  // Art-deco box: a tall auditorium block and a stepped entrance front with vertical fins.
  box(group, x0, 0.05, z0, x1 - x0, h - 0.05, z1 - z0, renderMat(0xefe4d6));
  box(group, x0 + 0.35, h, z0 + 0.25, x1 - x0 - 0.7, 0.12, z1 - z0 - 0.35, renderMat(0xe6d9c8));
  for (let i = 0; i < 5; i += 1) box(group, x0 + 0.22 + i * (x1 - x0 - 0.44) / 4 - 0.02, 0.45, z1 - 0.005, 0.04, h - 0.38, 0.04, renderMat(0xd9c9b4));
  bandOn(group, 'south', z1, x0, x1 - x0, h - 0.07, { color: 0x8a5a6e, h: 0.06 });
  bandOn(group, 'east', x1, z0, z1 - z0, h - 0.07, { color: 0x8a5a6e, h: 0.06 });
  // Glazed lobby, doors and the lit marquee canopy with bulbs.
  shopfrontOn(group, 'south', z1, x0 + 0.25, x1 - x0 - 0.5, 0.36, { frame: P.charcoal, lit: true });
  const mq = box(group, x0 + 0.15, 0.4, z1, x1 - x0 - 0.3, 0.06, 0.32, mat(0x8a5a6e, { rough: 0.5 }));
  void mq;
  for (let i = 0; i < 16; i += 1) glowing(sphere(group, x0 + 0.17 + i * (x1 - x0 - 0.34) / 15, 0.395, z1 + 0.32, 0.01, mat(0xfff2c8, { emissive: 0x332a10 }), 0), 0xffe7a8);
  signOn(group, 'south', z1 + 0.325, x0 + 0.25, 0.41, x1 - x0 - 0.5, 0.05, 'NOW SHOWING', { bg: '#fff6e0', fg: '#8a3b52', font: '800 48px Verdana, sans-serif' });
  // Vertical blade sign on the corner.
  box(group, x1 - 0.08, 0.5, z1 - 0.02, 0.06, 0.38, 0.12, mat(0x2a1e24));
  const blade = new THREE.Group(); blade.position.set(x1 - 0.02, 0, z1 - 0.02); blade.rotation.y = Math.PI / 2; group.add(blade);
  signOn(blade, 'south', 0.001, -0.1, 0.52, 0.08, 0.34, 'C', { bg: '#2a1e24', fg: '#ffc366', font: '900 120px Georgia, serif' });
  for (let i = 0; i < 6; i += 1) glowing(sphere(group, x1 - 0.05, 0.53 + i * 0.06, z1 + 0.11, 0.01, mat(0xfff2c8), 0), 0xffd27a);
  // Poster cases, a ticket kiosk, queue rails and trees on the forecourt.
  for (const px of [x0 + 0.02, x1 - 0.2]) { const poster = box(group, px, 0.12, z1 + 0.005, 0.16, 0.22, 0.02, mat(0x3a4a6a)); poster.userData.window = true; poster.userData.lit = true; }
  windowOn(group, 'east', x1, z0 + 0.3, 0.5, 0.4, 0.16, { frame: P.charcoal, sill: false });
  box(group, W - 0.65, 0, D - 0.75, 0.32, 0.26, 0.24, mat(0x8a5a6e, { rough: 0.6 }), 0.02);
  const booth = box(group, W - 0.61, 0.1, D - 0.505, 0.24, 0.1, 0.006, glass(0xbfdde2)); booth.userData.window = true; booth.userData.lit = true;
  signOn(group, 'south', D - 0.5, W - 0.62, 0.21, 0.26, 0.04, 'TICKETS', { bg: '#fff6e0', fg: '#8a3b52', font: '800 44px Verdana, sans-serif' });
  for (let i = 0; i < 4; i += 1) bollard(group, 0.5 + i * 0.28, D - 0.62);
  box(group, 0.5, 0.06, D - 0.625, 0.84, 0.012, 0.012, mat(0x8a3b52));
  for (const tx of [0.15, W - 0.15]) { broadleaf(group, tx, D - 0.15, random, { scale: 0.95, leaves: tx < 1 ? 'round' : 'lime' }); }
  streetLamp(group, 1.6, D - 0.12, { height: 0.55 });
  return group;
}

// ─── Music club (3×2) ─────────────────────────────────────────────────────────────────────────────────────────────
export function buildNightclub(group, W, D, seed) {
  const random = rng(seed);
  plate(group, W, D, 0x7f9f6c);
  box(group, 0.03, 0, D - 0.62, W - 0.06, 0.014, 0.6, pavingMat(0xcfc7b6));
  const x0 = 0.12, x1 = W - 0.12, z0 = 0.12, z1 = D - 0.65, h = 0.62;
  // Dark brick block with a glowing neon sign, a stage-door canopy and a rooftop lounge.
  box(group, x0, 0, z0, x1 - x0, h, z1 - z0, brickMat(0x5a3f3a));
  bandOn(group, 'south', z1, x0, x1 - x0, h - 0.05, { color: 0x2a2228, h: 0.05 });
  bandOn(group, 'east', x1, z0, z1 - z0, h - 0.05, { color: 0x2a2228, h: 0.05 });
  doorOn(group, 'south', z1, (x0 + x1) / 2 - 0.12, 0.24, 0.3, { color: 0x1f1a1e, frame: 0x2a2228, canopy: 0x2a2228 });
  for (const wx of [x0 + 0.12, x1 - 0.42]) {
    const pane = box(group, wx, 0.12, z1 + 0.004, 0.3, 0.16, 0.006, glass(0x6a4a8a)); pane.userData.window = true; pane.userData.lit = true;
  }
  // Neon: tubes framing the sign and a pink-blue wave across the front (they glow in the night pass).
  const neonPink = 0xff4fa8, neonBlue = 0x5fd0ff;
  const sign = signOn(group, 'south', z1 + 0.02, (x0 + x1) / 2 - 0.42, 0.4, 0.84, 0.13, 'LIVE MUSIC', { bg: '#1a1420', fg: '#ff78c0', font: '800 64px Verdana, sans-serif' });
  void sign;
  for (const [y, color] of [[0.385, neonPink], [0.545, neonBlue]]) glowing(box(group, (x0 + x1) / 2 - 0.45, y, z1 + 0.03, 0.9, 0.012, 0.012, mat(color, { emissive: 0x220022 })), color);
  for (let i = 0; i < 9; i += 1) glowing(box(group, x0 + 0.05 + i * (x1 - x0 - 0.1) / 9, 0.08 + (i % 2) * 0.03, z1 + 0.03, (x1 - x0 - 0.1) / 9 - 0.01, 0.01, 0.01, mat(i % 2 ? neonBlue : neonPink)), i % 2 ? neonBlue : neonPink);
  glowing(box(group, x1 + 0.005, 0.2, z0 + 0.15, 0.01, 0.012, z1 - z0 - 0.3, mat(neonPink)), neonPink);
  // Rooftop lounge: deck, glass rail, a canopy, lit bar and loungers.
  flatRoof(group, x0, z0, x1, z1, h, { color: 0x2a2228, deck: 0x6b5a50 });
  box(group, x0 + 0.08, h + 0.02, z0 + 0.08, x1 - x0 - 0.16, 0.015, z1 - z0 - 0.16, woodMat(0x8a6a4a));
  box(group, x0 + 0.1, h + 0.03, z0 + 0.1, 0.5, 0.1, 0.12, mat(0x2a2228));
  glowing(box(group, x0 + 0.1, h + 0.13, z0 + 0.1, 0.5, 0.01, 0.12, mat(0xffc366)), 0xffc366);
  for (let i = 0; i < 4; i += 1) umbrella(group, x0 + 0.85 + i * 0.4, z1 - 0.2, i % 2 ? 0x2a2228 : 0x8a3b6e);
  lights(group, new THREE.Vector3(x0 + 0.1, h + 0.32, z1 - 0.08), new THREE.Vector3(x1 - 0.1, h + 0.32, z1 - 0.08), 10, 0xffd58a, 0.04);
  // Queue rail with posts and a red rope on the pavement, a lamp and a bike rack.
  for (let i = 0; i < 5; i += 1) cylinder(group, x0 + 0.25 + i * 0.22, 0, D - 0.42, 0.012, 0.016, 0.12, mat(0xc9a46a, { metal: 0.7, rough: 0.3 }), 8);
  box(group, x0 + 0.25, 0.1, D - 0.425, 0.88, 0.012, 0.01, mat(0xb03040));
  streetLamp(group, W - 0.18, D - 0.12, { height: 0.5 });
  bikeRack(group, W - 0.65, D - 0.3, 2, random);
  return group;
}

// ─── Concert stage (4×4) ──────────────────────────────────────────────────────────────────────────────────────────
export function buildStage(group, W, D, seed) {
  const random = rng(seed);
  plate(group, W, D, 0x86ad70);
  // Audience lawn in front, a paved apron and the stage under a white acoustic shell at the back.
  box(group, 0.3, 0, 1.55, W - 0.6, 0.014, 0.25, pavingMat(0xe6dcc8));
  box(group, 0.6, 0, 0.3, W - 1.2, 0.16, 1.25, woodMat(0x8a6a4a), 0.01);
  box(group, 0.55, 0.16, 1.48, W - 1.1, 0.03, 0.08, mat(P.charcoal));
  // Acoustic shell: the back half of a dome standing over the stage, open to the audience (double-sided, so its
  // white inside faces the lawn), with a coloured rim.
  const shell = enable(new THREE.Mesh(new THREE.SphereGeometry(1.0, 40, 20, Math.PI, Math.PI, 0, Math.PI / 2), mat(0xf6f3ec, { rough: 0.45, side: THREE.DoubleSide })));
  shell.scale.set(1, 0.8, 0.95); shell.position.set(W / 2, 0.16, 1.22);
  group.add(shell);
  const rim = enable(new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.025, 8, 40, Math.PI), mat(0xc8674a, { rough: 0.5 })));
  rim.scale.set(1, 0.8, 1); rim.position.set(W / 2, 0.16, 1.22); group.add(rim);
  // Instruments: drum kit, piano, speaker stacks and a lit sign band.
  cylinder(group, W / 2, 0.19, 0.65, 0.07, 0.07, 0.06, mat(0xc8674a, { rough: 0.4 }), 16);
  for (const dx of [-0.12, 0.12]) cylinder(group, W / 2 + dx, 0.19, 0.72, 0.045, 0.045, 0.05, mat(P.ivory), 14);
  box(group, W / 2 - 0.6, 0.19, 0.55, 0.28, 0.1, 0.14, mat(0x1f1a1e, { rough: 0.3 }));
  for (const sx of [0.62, W - 0.8]) { box(group, sx, 0.19, 1.2, 0.18, 0.32, 0.16, mat(0x2a2a2e)); for (const y of [0.27, 0.42]) cylinder(group, sx + 0.09, y, 1.36, 0.05, 0.05, 0.005, mat(0x55585e), 14).rotation.x = Math.PI / 2; }
  // Light towers with coloured lamps either side, aimed at the stage.
  const towerColors = [[0xff5e8a, 0x5fd0ff, 0xffc366], [0x7fd0c6, 0xffc366, 0xff7a59]];
  for (const [index, tx] of [[0, 0.22], [1, W - 0.3]]) {
    box(group, tx, 0, 1.4, 0.06, 0.95, 0.06, mat(0x3d464b, { metal: 0.5, rough: 0.4 }));
    box(group, tx - 0.06, 0.9, 1.38, 0.18, 0.04, 0.1, mat(0x3d464b, { metal: 0.5 }));
    towerColors[index].forEach((color, i) => glowing(box(group, tx - 0.05 + i * 0.06, 0.85, 1.42, 0.045, 0.045, 0.06, mat(color, { emissive: 0x222222 })), color));
  }
  signOn(group, 'south', 1.49, W / 2 - 0.55, 0.19, 1.1, 0.07, 'BAYSIDE STAGE', { bg: '#2f4a3a', fg: '#f6d27a', font: '800 52px Verdana, sans-serif' });
  // Lawn edge: lamps, benches at the back of the lawn, trees and hedges at the sides, a kiosk.
  for (const lx of [0.15, W - 0.15]) for (const lz of [2.2, 3.3]) streetLamp(group, lx, lz, { height: 0.55 });
  bench(group, 0.9, D - 0.18, 'x'); bench(group, W - 0.9, D - 0.18, 'x');
  hedge(group, 0.04, 1.9, D - 2.0, 'z', { h: 0.1, w: 0.08 }); hedge(group, W - 0.12, 1.9, D - 2.0, 'z', { h: 0.1, w: 0.08 });
  for (const [tx, tz] of [[0.2, 0.2], [W - 0.2, 0.25], [0.15, 1.2], [W - 0.15, 1.1]]) broadleaf(group, tx, tz, random, { scale: 1.05, leaves: tx < 1 ? 'round' : 'olive' });
  kiosk(group, W - 0.7, D - 0.6, random, [0x3f8d8a, P.ivory]);
  bin(group, 0.5, D - 0.3);
  return group;
}

// ─── Performance plaza (3×3) ──────────────────────────────────────────────────────────────────────────────────────
export function buildPlaza(group, W, D, seed) {
  const random = rng(seed);
  plate(group, W, D, 0x86ad70);
  box(group, 0.08, 0, 0.08, W - 0.16, 0.016, D - 0.16, mat(0xe6d9bf, { rough: 1, tex: 'paving', texScale: 0.7 }));
  // Rings of contrasting paving around the centre.
  for (let r = 0; r < 3; r += 1) {
    const ring = enable(new THREE.Mesh(new THREE.RingGeometry(0.45 + r * 0.3, 0.5 + r * 0.3, 40), mat(r % 2 ? 0xd2c3a3 : 0xc9b48e, { rough: 1, side: THREE.DoubleSide })));
    ring.rotation.x = -Math.PI / 2; ring.position.set(W / 2 + 0.2, 0.018, D / 2 + 0.2); group.add(ring);
  }
  // A small covered performance platform at the back-left with a canopy and two spotlights.
  box(group, 0.2, 0, 0.2, 1.1, 0.12, 0.7, stoneMat(0xd8cdb6), 0.01);
  for (const [px, pz] of [[0.22, 0.22], [1.24, 0.22]]) box(group, px, 0.12, pz, 0.04, 0.5, 0.04, mat(P.charcoal, { metal: 0.4 }));
  box(group, 0.18, 0.62, 0.18, 1.14, 0.035, 0.45, mat(0xc8674a, { rough: 0.6 }));
  for (const [sx, color] of [[0.35, 0xffc366], [1.1, 0xff7a59]]) glowing(box(group, sx, 0.56, 0.62, 0.05, 0.04, 0.05, mat(color, { emissive: 0x222200 })), color);
  signOn(group, 'south', 0.905, 0.4, 0.04, 0.7, 0.06, 'PLAZA STAGE', { bg: '#2f4a3a', fg: '#f6d27a', font: '800 50px Verdana, sans-serif' });
  // Fountain off-centre to the right, benches around, trees with seating, lamps and planters.
  const fx = W - 0.85, fz = 0.95;
  cylinder(group, fx, 0, fz, 0.32, 0.34, 0.08, stoneMat(0xe0d6c2), 32);
  cylinder(group, fx, 0.06, fz, 0.28, 0.28, 0.03, new THREE.MeshPhysicalMaterial({ color: 0x4fbac6, roughness: 0.05, clearcoat: 1 }), 32);
  cylinder(group, fx, 0.06, fz, 0.05, 0.07, 0.24, mat(P.ivory), 12);
  sphere(group, fx, 0.33, fz, 0.06, new THREE.MeshPhysicalMaterial({ color: 0xe6f7f7, transparent: true, opacity: 0.75 }), 2);
  for (const [bx, bz, axis] of [[0.4, D - 0.2, 'x'], [1.3, D - 0.2, 'x'], [W - 0.2, 1.7, 'z'], [W - 0.2, 2.4, 'z']]) bench(group, bx, bz, axis);
  for (const [tx, tz] of [[0.18, D - 0.18], [W - 0.18, D - 0.18], [W - 0.2, 0.2]]) { box(group, tx - 0.13, 0, tz - 0.13, 0.26, 0.08, 0.26, stoneMat(0xd8cdb6), 0.01); broadleaf(group, tx, tz, random, { scale: 1.0, leaves: 'lime' }); }
  for (const [lx, lz] of [[1.45, 1.25], [0.2, 1.4]]) streetLamp(group, lx, lz, { height: 0.55 });
  lights(group, new THREE.Vector3(0.24, 0.6, 0.24), new THREE.Vector3(fx, 0.5, fz + 0.4), 10, 0xffd58a, 0.08);
  flowerbed(group, W - 0.65, D - 0.5, 0.4, 0.14, random); pottedPlant(group, 1.45, 0.3, random, 1.3);
  bin(group, W - 1.2, D - 0.18);
  return group;
}

// ─── Amusement park (6×5) ─────────────────────────────────────────────────────────────────────────────────────────
export function buildAmusement(group, W, D, seed) {
  const random = rng(seed);
  plate(group, W, D, 0x8eb575);
  // Paths: a loop from the gate at the front around the rides.
  path(group, 0.4, D - 0.5, W - 0.8, 0.32, 0xe9d8b8);
  path(group, W / 2 - 0.2, 1.2, 0.4, D - 1.5, 0xe9d8b8);
  path(group, 0.4, 1.9, W - 0.8, 0.3, 0xe9d8b8);
  // Ferris wheel (back-left): a ring of gondolas on spokes, on an A-frame.
  const wx = 1.25, wz = 0.85, wr = 0.75, hub = 0.95;
  const frame = mat(0xf3f0e8, { metal: 0.3, rough: 0.4 });
  for (const dz of [-0.12, 0.12]) for (const dx of [-0.45, 0.45]) {
    const leg = box(group, wx - 0.015, 0, wz + dz - 0.015, 0.03, hub * 1.05, 0.03, frame);
    leg.rotation.z = dx > 0 ? -0.42 : 0.42; leg.position.set(wx + dx / 2, hub / 2, wz + dz);
  }
  const wheel = new THREE.Group(); wheel.position.set(wx, hub, wz); group.add(wheel);
  const rim = enable(new THREE.Mesh(new THREE.TorusGeometry(wr, 0.018, 8, 48), mat(0xe8504a, { rough: 0.4 }))); wheel.add(rim);
  const rim2 = rim.clone(); rim2.position.z = 0.08; wheel.add(rim2);
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    const spoke = enable(new THREE.Mesh(new THREE.BoxGeometry(0.012, wr, 0.012), frame)); spoke.position.set(Math.cos(a) * wr / 2, Math.sin(a) * wr / 2, 0.04); spoke.rotation.z = a - Math.PI / 2; wheel.add(spoke);
    const cabin = enable(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.1), mat([0xe8b04a, 0x5fb0aa, 0xe88b74, 0x8fbcd6][i % 4], { rough: 0.5 })));
    cabin.position.set(Math.cos(a) * wr, Math.sin(a) * wr - 0.07, 0.04); wheel.add(cabin);
    const bulb = enable(new THREE.Mesh(new THREE.IcosahedronGeometry(0.012, 0), mat(0xfff2c8))); bulb.position.set(Math.cos(a) * wr, Math.sin(a) * wr, 0.1); glowing(bulb, i % 2 ? 0xffd27a : 0xff7a9a); wheel.add(bulb);
  }
  const hubLight = glowing(enable(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12), mat(0xffd27a))), 0xffd27a);
  hubLight.rotation.x = Math.PI / 2; hubLight.position.z = 0.04; wheel.add(hubLight);
  // Carousel (centre-right): striped canopy, poles and horses on a platform.
  const cx = W - 1.6, cz = 1.15;
  cylinder(group, cx, 0, cz, 0.5, 0.52, 0.07, mat(0xe9dcc4), 32);
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * Math.PI * 2;
    cylinder(group, cx + Math.cos(a) * 0.38, 0.07, cz + Math.sin(a) * 0.38, 0.008, 0.008, 0.36, mat(0xc9a46a, { metal: 0.7, rough: 0.3 }), 6);
    box(group, cx + Math.cos(a) * 0.38 - 0.04, 0.16 + (i % 2) * 0.05, cz + Math.sin(a) * 0.38 - 0.015, 0.08, 0.05, 0.03, mat([P.ivory, 0xe8b04a, 0x8fbcd6][i % 3], { rough: 0.5 }));
  }
  const canopy = enable(new THREE.Mesh(new THREE.ConeGeometry(0.56, 0.24, 20), mat(0xd94f5a, { rough: 0.6 }))); canopy.position.set(cx, 0.55, cz); group.add(canopy);
  for (let i = 0; i < 20; i += 2) {
    const a = (i / 20) * Math.PI * 2;
    const stripe = enable(new THREE.Mesh(new THREE.ConeGeometry(0.565, 0.245, 20, 1, true, a, Math.PI / 10), mat(P.ivory, { rough: 0.6, side: THREE.DoubleSide }))); stripe.position.set(cx, 0.551, cz); group.add(stripe);
  }
  for (let i = 0; i < 12; i += 1) { const a = (i / 12) * Math.PI * 2; glowing(sphere(group, cx + Math.cos(a) * 0.55, 0.43, cz + Math.sin(a) * 0.55, 0.012, mat(0xfff2c8), 0), 0xffe7a8); }
  sphere(group, cx, 0.7, cz, 0.04, mat(P.gold, { metal: 0.6, rough: 0.3 }), 1);
  // Mini coaster along the east side and back: a track on trestles with a small train.
  const track = mat(0x3f8d8a, { metal: 0.4, rough: 0.4 }), trestle = mat(0xf3f0e8, { rough: 0.5 });
  const points = [];
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    const x = W - 0.35, z = D - 0.9 - t * (D - 1.4);
    points.push(new THREE.Vector3(x, 0.18 + Math.sin(t * Math.PI * 2) * 0.12 + t * 0.15, z));
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i], b = points[i + 1];
    const seg = enable(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, a.distanceTo(b) + 0.01), track));
    seg.position.copy(a.clone().add(b).multiplyScalar(0.5)); seg.lookAt(b); group.add(seg);
    if (i % 3 === 0) box(group, a.x - 0.01, 0, a.z - 0.01, 0.02, a.y, 0.02, trestle);
  }
  for (let i = 0; i < 3; i += 1) box(group, W - 0.4, points[6 + i].y + 0.02, points[6 + i].z - 0.05, 0.1, 0.06, 0.1, mat([0xe8504a, 0xe8b04a, 0xe8504a][i], { rough: 0.4 }), 0.01);
  // Food kiosks, umbrellas with tables, balloons, benches, bins and planting.
  kiosk(group, 0.35, 2.4, random, [0xe8504a, P.ivory]); kiosk(group, 1.0, 2.4, random, [P.gold, 0xe8504a]);
  for (const [ux, uz, color] of [[1.9, 2.9, 0x3f8d8a], [2.45, 3.05, 0xe8504a], [1.6, 3.4, P.gold]]) umbrella(group, ux, uz, color);
  for (let i = 0; i < 5; i += 1) { cylinder(group, 3.2 + i * 0.05, 0, 3.0, 0.003, 0.003, 0.4 + i * 0.03, mat(P.white), 4); sphere(group, 3.2 + i * 0.05, 0.42 + i * 0.03, 3.0, 0.035, mat([0xe8504a, P.gold, 0x5fb0aa, 0xd94f8a, 0x8fbcd6][i], { rough: 0.3 }), 1); }
  for (const [bx, bz] of [[0.9, D - 0.62], [3.2, D - 0.62]]) bench(group, bx, bz, 'x');
  bin(group, 2.2, D - 0.65); bin(group, 4.0, 2.1);
  for (const [tx, tz] of [[0.15, 0.15], [0.15, 1.8], [W - 1.0, 0.15], [0.2, D - 0.2], [W - 0.9, D - 0.2]]) (tz > D - 0.5 ? palm : broadleaf)(group, tx, tz, random, { scale: 1.1, leaves: 'round' });
  hedge(group, 0.04, 0.4, D - 1.0, 'z', { h: 0.1, w: 0.08 });
  flowerbed(group, 2.7, 2.35, 0.8, 0.16, random); shrub(group, 2.0, 2.4, random, { scale: 1.2, flowers: P.coral });
  // Entrance gate with a lettered arch at the front.
  const gx = W / 2 - 0.6;
  for (const px of [gx, gx + 1.15]) { box(group, px, 0, D - 0.16, 0.08, 0.62, 0.08, mat(0xe8504a, { rough: 0.5 })); sphere(group, px + 0.04, 0.66, D - 0.12, 0.05, mat(P.gold, { metal: 0.5 }), 1); }
  box(group, gx - 0.02, 0.56, D - 0.17, 1.27, 0.08, 0.1, mat(0xf3f0e8, { rough: 0.5 }));
  signOn(group, 'south', D - 0.065, gx + 0.08, 0.565, 1.07, 0.07, 'FUN PARK', { bg: '#e8504a', fg: '#fff6e0', font: '900 60px Verdana, sans-serif' });
  for (let i = 0; i < 10; i += 1) glowing(sphere(group, gx + 0.04 + i * 0.125, 0.66, D - 0.06, 0.012, mat(0xfff2c8), 0), i % 2 ? 0xffd27a : 0xff7a9a);
  return group;
}

/** Bake entries: id `<type>.v<variant>.<front>`; east-facing lots build with W and D swapped. */
export function venueAssets() {
  const entry = (kind, variant, w, d, build, seed) => ['S', 'E'].map((front) => ({
    id: `${kind}.v${variant}.${front}`, kind, variant, front, footprint: { w, d },
    build: (g) => front === 'S' ? build(g, w, d, seed) : build(g, d, w, seed + 1),
  }));
  return [
    ...CAFE_VARIANTS.flatMap((_, index) => entry('cafe', index, 2, 2, (g, W, D, seed) => buildCafe(g, index, W, D, seed), 9100 + index * 31)),
    ...entry('shops', 0, 4, 2, buildShops, 9200),
    ...entry('market', 0, 4, 3, buildMarket, 9300),
    ...entry('cinema', 0, 3, 3, buildCinema, 9400),
    ...entry('nightclub', 0, 3, 2, buildNightclub, 9500),
    ...entry('stage', 0, 4, 4, buildStage, 9600),
    ...entry('plaza', 0, 3, 3, buildPlaza, 9700),
    ...entry('amusement', 0, 6, 5, buildAmusement, 9800),
  ];
}
