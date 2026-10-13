// Detail props and street furniture for Visual World 3.0B. Same conventions as kit.js: 1 unit = 1 tile, +Y up,
// south (+Z) and east (+X) faces visible. Everything is seeded and deterministic.
import * as THREE from 'three';
import { PALETTE as P, mat, box, cylinder, sphere, wall, glass, woodMat, stoneMat, pick } from './kit.js';

function enable(mesh) { mesh.castShadow = true; mesh.receiveShadow = true; return mesh; }

/** Flower box under a window on any wall. */
export function windowBox(parent, side, plane, u, w, v, random, color = P.timber) {
  const { g, span } = wall(parent, side, plane);
  const x = span(u, w);
  box(g, x, v - 0.06, 0, w, 0.05, 0.06, mat(color, { rough: 0.8 }));
  const n = Math.max(3, Math.round(w / 0.035));
  for (let i = 0; i < n; i += 1) {
    const px = x + 0.015 + (w - 0.03) * (i + 0.5) / n;
    sphere(g, px, v - 0.005, 0.03, 0.022, mat(pick(random, [P.leaf, P.moss, 0x7fae69]), { rough: 0.95 }), 1);
    if (random() < 0.7) sphere(g, px + 0.006, v + 0.012, 0.042, 0.011, mat(pick(random, [P.coral, 0xf4a6b8, P.gold, 0xb9a3e3, P.white]), { rough: 0.6 }), 0);
  }
  // A few trailing plants.
  for (let i = 0; i < 2; i += 1) sphere(g, x + w * (0.25 + i * 0.5), v - 0.07, 0.05, 0.018, mat(P.moss, { rough: 0.95 }), 1);
}

/** Wall lantern beside a door; its glass glows at night. */
export function wallLamp(parent, side, plane, u, v) {
  const { g, span } = wall(parent, side, plane);
  const x = span(u, 0.04);
  box(g, x + 0.01, v, 0, 0.02, 0.02, 0.03, mat(P.charcoal, { metal: 0.5, rough: 0.4 }));
  const head = box(g, x, v - 0.03, 0.025, 0.04, 0.06, 0.04, mat(0xfff0c8, { rough: 0.3, emissive: 0x2a2010 }));
  head.userData.lamp = true;
  box(g, x - 0.005, v + 0.03, 0.02, 0.05, 0.012, 0.05, mat(P.charcoal, { metal: 0.5, rough: 0.4 }));
}

/** Downpipe and gutter on a wall edge. */
export function downpipe(parent, x, z, height) {
  box(parent, x - 0.012, 0, z - 0.012, 0.024, height, 0.024, mat(0x8a9399, { rough: 0.45, metal: 0.4 }));
}

export function acUnit(parent, side, plane, u, v) {
  const { g, span } = wall(parent, side, plane);
  const x = span(u, 0.12);
  box(g, x, v, 0, 0.12, 0.08, 0.06, mat(0xe8e6e0, { rough: 0.6 }), 0.008);
  cylinder(g, x + 0.04, v + 0.012, 0.062, 0.025, 0.025, 0.002, mat(0x4a5258), 16).rotation.x = Math.PI / 2;
}

const signCache = new Map();
/** Canvas-lettered sign texture (original names only). */
function signTexture(text, bg, fg, font) {
  const key = `${text}|${bg}|${fg}|${font}`;
  if (!signCache.has(key)) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = fg; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 68);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    signCache.set(key, t);
  }
  return signCache.get(key);
}
/** Lettered sign board on a wall; `glow` makes it light up in the night pass. */
export function signOn(parent, side, plane, u, v, w, h, text, { bg = '#2f4a3a', fg = '#f6d27a', font = '700 70px Georgia, serif', frame = P.charcoal, glow = true } = {}) {
  const { g, span } = wall(parent, side, plane);
  const x = span(u, w);
  box(g, x - 0.01, v - 0.01, 0, w + 0.02, h + 0.02, 0.025, mat(frame, { rough: 0.5, metal: 0.3 }));
  const material = new THREE.MeshStandardMaterial({ map: signTexture(text, bg, fg, font), roughness: 0.6 });
  const plane2 = enable(new THREE.Mesh(new THREE.PlaneGeometry(w, h), material));
  plane2.position.set(x + w / 2, v + h / 2, 0.026);
  if (glow) plane2.userData.sign = true;
  g.add(plane2);
  return plane2;
}
/** Free-standing pylon sign (two-faced: south and east). */
export function pylonSign(parent, x, z, h, text, opts = {}) {
  box(parent, x - 0.04, 0, z - 0.04, 0.08, h, 0.08, mat(P.charcoal, { metal: 0.4, rough: 0.4 }));
  const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
  box(g, -0.16, h, -0.04, 0.32, 0.22, 0.08, mat(opts.frame ?? P.charcoal, { rough: 0.5 }));
  signOn(g, 'south', 0.04, -0.15, h + 0.01, 0.3, 0.2, text, { ...opts, frame: opts.frame ?? P.charcoal });
}

/** Chunky stylised parked car (static decor in parking bays). */
export function car(parent, x, z, rotation, color, random) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.35, metal: 0.25 });
  box(g, -0.17, 0.035, -0.08, 0.34, 0.075, 0.16, body, 0.03);
  box(g, -0.09, 0.1, -0.07, 0.17, 0.06, 0.14, body, 0.025);
  const g1 = box(g, -0.088, 0.105, -0.072, 0.168, 0.05, 0.144, glass(0x2f4652));
  g1.userData.window = true; g1.userData.lit = false;
  for (const [wx, wz] of [[-0.11, -0.08], [0.11, -0.08], [-0.11, 0.08], [0.11, 0.08]]) {
    const w = cylinder(g, 0, 0, 0, 0.035, 0.035, 0.03, mat(0x2b2f33, { rough: 0.8 }), 14);
    w.rotation.x = Math.PI / 2; w.position.set(wx, 0.035, wz);
  }
  box(g, 0.165, 0.06, -0.06, 0.01, 0.02, 0.03, mat(0xfff4d0, { emissive: 0x332b10 }));
  box(g, 0.165, 0.06, 0.03, 0.01, 0.02, 0.03, mat(0xfff4d0, { emissive: 0x332b10 }));
  box(g, -0.175, 0.06, -0.06, 0.01, 0.02, 0.12, mat(0xc0392b, { rough: 0.4 }));
  g.position.set(x, 0, z); g.rotation.y = rotation + (random() - 0.5) * 0.05;
  parent.add(g);
}
export const CAR_COLORS = [0xe8b04a, 0x5fb0aa, 0xe88b74, 0xf3f0e8, 0x6f8fb0, 0xc94f4f, 0x3d464b, 0x9fc58f];

export function parkingBay(parent, x, z, w, d, axis = 'x') {
  box(parent, x, 0, z, w, 0.008, d, mat(0x6d7880, { rough: 0.95, tex: 'asphalt' }));
  const n = Math.max(1, Math.round((axis === 'x' ? w : d) / 0.24));
  for (let i = 0; i <= n; i += 1) {
    if (axis === 'x') box(parent, x + (w - 0.01) * i / n, 0.008, z + 0.02, 0.01, 0.002, d * 0.55, mat(P.white));
    else box(parent, x + 0.02, 0.008, z + (d - 0.01) * i / n, w * 0.55, 0.002, 0.01, mat(P.white));
  }
}

export function bin(parent, x, z, color = 0x4f7f6a) {
  cylinder(parent, x, 0, z, 0.03, 0.026, 0.08, mat(color, { rough: 0.5, metal: 0.2 }), 12);
  cylinder(parent, x, 0.08, z, 0.033, 0.033, 0.01, mat(P.charcoal, { metal: 0.3 }), 12);
}
export function bollard(parent, x, z) { cylinder(parent, x, 0, z, 0.016, 0.018, 0.07, mat(P.charcoal, { metal: 0.4, rough: 0.4 }), 10); }
export function bikeRack(parent, x, z, count, random) {
  for (let i = 0; i < count; i += 1) {
    const g = new THREE.Group(); g.position.set(x + i * 0.07, 0, z);
    const frame = mat(pick(random, [P.coral, P.teal, P.gold, 0x5f8fa8, P.white]), { rough: 0.5, metal: 0.2 });
    for (const dz of [-0.06, 0.06]) { const w = cylinder(g, 0, 0, 0, 0.032, 0.032, 0.008, mat(0x2b2f33), 14); w.rotation.x = Math.PI / 2; w.rotation.z = Math.PI / 2; w.position.set(0, 0.032, dz); }
    box(g, -0.005, 0.03, -0.06, 0.01, 0.01, 0.12, frame); box(g, -0.005, 0.03, -0.01, 0.01, 0.05, 0.01, frame); box(g, -0.005, 0.075, -0.02, 0.01, 0.01, 0.06, frame);
    parent.add(g);
  }
}
export function picnicTable(parent, x, z) {
  const wood = woodMat(P.timber);
  box(parent, x - 0.12, 0.08, z - 0.06, 0.24, 0.015, 0.12, wood);
  for (const dz of [-0.11, 0.08]) box(parent, x - 0.12, 0.045, z + dz, 0.24, 0.012, 0.03, wood);
  for (const dx of [-0.1, 0.08]) box(parent, x + dx, 0, z - 0.1, 0.02, 0.08, 0.2, mat(P.walnut));
}
export function pottedPlant(parent, x, z, random, scale = 1) {
  cylinder(parent, x, 0, z, 0.035 * scale, 0.026 * scale, 0.06 * scale, mat(pick(random, [P.terracotta, 0xe9e4da, P.charcoal]), { rough: 0.7 }), 12);
  for (let i = 0; i < 4; i += 1) sphere(parent, x + (random() - 0.5) * 0.03 * scale, 0.08 * scale + random() * 0.03 * scale, z + (random() - 0.5) * 0.03 * scale, 0.03 * scale, mat(pick(random, [P.leaf, 0x5f9654, P.forest]), { rough: 0.95, tex: 'leaves' }), 1);
}
export function picketFence(parent, x0, z0, length, axis, color = P.white) {
  const m = mat(color, { rough: 0.7 });
  const n = Math.round(length / 0.045);
  for (let i = 0; i <= n; i += 1) {
    const t = (length * i) / n;
    if (axis === 'x') box(parent, x0 + t - 0.006, 0, z0 - 0.006, 0.012, 0.09, 0.012, m); else box(parent, x0 - 0.006, 0, z0 + t - 0.006, 0.012, 0.09, 0.012, m);
  }
  if (axis === 'x') { box(parent, x0, 0.03, z0 - 0.004, length, 0.012, 0.008, m); box(parent, x0, 0.065, z0 - 0.004, length, 0.012, 0.008, m); }
  else { box(parent, x0 - 0.004, 0.03, z0, 0.008, 0.012, length, m); box(parent, x0 - 0.004, 0.065, z0, 0.008, 0.012, length, m); }
}
export function lowWall(parent, x0, z0, length, axis, h = 0.08) {
  if (axis === 'x') box(parent, x0, 0, z0, length, h, 0.06, stoneMat(0xd8cdb6), 0.01); else box(parent, x0, 0, z0, 0.06, h, length, stoneMat(0xd8cdb6), 0.01);
}
export function pergola(parent, x, z, w, d, h = 0.32, color = P.timber, random = null) {
  const wood = mat(color, { rough: 0.8 });
  for (const [px, pz] of [[x, z], [x + w - 0.03, z], [x, z + d - 0.03], [x + w - 0.03, z + d - 0.03]]) box(parent, px, 0, pz, 0.03, h, 0.03, wood);
  box(parent, x - 0.02, h, z, w + 0.04, 0.025, 0.025, wood); box(parent, x - 0.02, h, z + d - 0.025, w + 0.04, 0.025, 0.025, wood);
  const n = Math.round(w / 0.07);
  for (let i = 0; i <= n; i += 1) box(parent, x + (w - 0.015) * i / n, h + 0.025, z - 0.03, 0.015, 0.02, d + 0.06, wood);
  if (random) for (let i = 0; i < 10; i += 1) sphere(parent, x + random() * w, h + 0.05, z + random() * d, 0.04 + random() * 0.03, mat(pick(random, [0x5f9654, P.moss, 0x6fa95e]), { rough: 0.95, tex: 'leaves' }), 1);
  if (random) for (let i = 0; i < 6; i += 1) sphere(parent, x + random() * w, h + 0.07, z + random() * d, 0.018, mat(pick(random, [0xd94f8a, 0xf4a6b8, P.white]), { rough: 0.6 }), 0);
}
export function playground(parent, x, z, random) {
  box(parent, x, 0, z, 0.7, 0.012, 0.6, mat(0xd9a46a, { rough: 1, tex: 'cobble', texScale: 0.5 }));
  // Climbing tower with a slide.
  const posts = mat(0x5f8fa8, { rough: 0.5, metal: 0.2 });
  for (const [px, pz] of [[0.1, 0.1], [0.3, 0.1], [0.1, 0.3], [0.3, 0.3]]) box(parent, x + px, 0, z + pz, 0.02, 0.3, 0.02, posts);
  box(parent, x + 0.09, 0.16, z + 0.09, 0.24, 0.02, 0.24, woodMat(P.timber));
  const roofCone = enable(new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.12, 4), mat(P.coral, { rough: 0.6 })));
  roofCone.position.set(x + 0.21, 0.37, z + 0.21); roofCone.rotation.y = Math.PI / 4; parent.add(roofCone);
  const slide = box(parent, x + 0.3, 0.08, z + 0.15, 0.32, 0.015, 0.1, mat(P.gold, { rough: 0.3 }));
  slide.rotation.z = -0.5; slide.position.set(x + 0.44, 0.1, z + 0.2);
  // Swing frame.
  const sw = mat(P.coral, { rough: 0.5, metal: 0.2 });
  for (const pz of [0.38, 0.56]) { box(parent, x + 0.45, 0, z + pz, 0.015, 0.26, 0.015, sw); box(parent, x + 0.65, 0, z + pz, 0.015, 0.26, 0.015, sw); }
  box(parent, x + 0.45, 0.26, z + 0.38, 0.215, 0.015, 0.015, sw); box(parent, x + 0.45, 0.26, z + 0.56, 0.215, 0.015, 0.015, sw);
  box(parent, x + 0.5, 0.08, z + 0.44, 0.06, 0.01, 0.06, mat(P.charcoal)); box(parent, x + 0.58, 0.08, z + 0.44, 0.06, 0.01, 0.06, mat(P.charcoal));
  void random;
}
export function sculpture(parent, x, z, color = P.coral) {
  box(parent, x - 0.1, 0, z - 0.1, 0.2, 0.06, 0.2, stoneMat(0xe0d6c2));
  const torus = enable(new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 12, 32), mat(color, { rough: 0.3, metal: 0.4 })));
  torus.position.set(x, 0.2, z); torus.rotation.y = Math.PI / 4; parent.add(torus);
}
export function kiosk(parent, x, z, random, awning = [P.coral, P.ivory]) {
  box(parent, x, 0, z, 0.3, 0.22, 0.24, mat(P.ivory, { tex: 'planks' }), 0.01);
  const glassFront = box(parent, x + 0.04, 0.08, z + 0.24, 0.22, 0.1, 0.006, glass(0xbfdde2));
  glassFront.userData.window = true; glassFront.userData.lit = true;
  for (let i = 0; i < 6; i += 1) box(parent, x - 0.02 + i * 0.057, 0.22, z - 0.02, 0.057, 0.04, 0.3, mat(awning[i % 2], { rough: 0.9 }));
  void random;
}
