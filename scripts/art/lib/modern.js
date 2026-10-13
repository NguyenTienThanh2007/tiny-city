// Visual World 3.1 architectural detail library: the modern vocabulary shared by the architecture collections
// (slabs, curtain glazing, timber slats, fins, stone feature walls, glass balustrades, pergolas, roof gardens,
// pools, lighting, landscaping). Same conventions as kit.js: 1 unit = 1 tile, +Z is the street (south) side,
// only the south (+Z) and east (+X) faces and roofs are ever seen, so detail goes there.
import * as THREE from 'three';
import { PALETTE as P, mat, box, cylinder, sphere, glass, wall, leafMat, concreteMat, stoneMat, woodMat, renderMat, wallMat, pavingMat, waterMat, pick } from './kit.js';

/** Luxury Minimalist material set (also the base for the other contemporary collections). */
export const LUX = {
  ivory: 0xf4efe6, warmWhite: 0xf8f4ec, concrete: 0xd6d0c4, stone: 0xcdbfa6, sandstone: 0xd9c8a8,
  walnut: 0x7a5236, oak: 0xa77b52, charcoal: 0x3a3f43, bronze: 0xb08d57, glassTint: 0x93b8c2, deck: 0xb08a63,
};
export const metal = (color = LUX.charcoal) => mat(color, { metal: 0.55, rough: 0.35 });
export const bronze = () => mat(LUX.bronze, { metal: 0.8, rough: 0.3 });
export const ivoryMat = (color = LUX.ivory) => renderMat(color);
export const plasterMat = (color = LUX.warmWhite) => wallMat(color);
export const concrete = (color = LUX.concrete) => concreteMat(color);
export const stone = (color = LUX.stone) => stoneMat(color);
export const walnut = (color = LUX.walnut) => woodMat(color);

/**
 * Crisp roof or floor slab from (x0, z0) to (x1, z1) at height y with thickness t. A thin dark reveal under the
 * edge makes the plate read as floating at gameplay zoom.
 */
export function slab(parent, x0, z0, x1, z1, y, { t = 0.06, color = LUX.ivory, reveal = true, material = null } = {}) {
  box(parent, x0, y, z0, x1 - x0, t, z1 - z0, material ?? mat(color, { rough: 0.6 }));
  if (reveal) box(parent, x0 + 0.03, y - 0.012, z0 + 0.03, x1 - x0 - 0.06, 0.012, z1 - z0 - 0.06, mat(0x5a5650, { rough: 0.9 }));
}

/** Gravel/deck roof surface with an upstand, for flat roofs seen from above. */
export function roofDeck(parent, x0, z0, x1, z1, y, { color = 0xc9c4ba, edge = LUX.ivory, h = 0.04 } = {}) {
  box(parent, x0, y, z0, x1 - x0, 0.015, z1 - z0, mat(color, { rough: 1, tex: 'concrete', texScale: 0.4 }));
  const m = mat(edge, { rough: 0.6 });
  box(parent, x0, y, z1 - 0.03, x1 - x0, h, 0.03, m); box(parent, x1 - 0.03, y, z0, 0.03, h, z1 - z0, m);
  box(parent, x0, y, z0, x1 - x0, h, 0.03, m); box(parent, x0, y, z0, 0.03, h, z1 - z0, m);
}

/**
 * Floor-to-ceiling glazing on a wall: one pane per bay between slim charcoal mullions, with a thin head and sill.
 * Returns the panes (tagged as windows so the night pass can light them).
 */
export function glassWall(parent, side, plane, u, v, w, h, { bay = 0.2, frame = LUX.charcoal, tint = LUX.glassTint, lit = null, transom = false } = {}) {
  const { g, span } = wall(parent, side, plane);
  const x = span(u, w);
  const fm = metal(frame);
  box(g, x, v, 0, w, h, 0.004, mat(0x27323a, { rough: 0.9 }));
  const bays = Math.max(1, Math.round(w / bay));
  const panes = [];
  for (let i = 0; i < bays; i += 1) {
    const pane = box(g, x + (w * i) / bays + 0.006, v + 0.012, 0.004, w / bays - 0.012, h - 0.024, 0.006, glass(tint));
    pane.userData.window = true;
    if (lit !== null) pane.userData.lit = typeof lit === 'function' ? lit(i) : lit;
    panes.push(pane);
  }
  for (let i = 0; i <= bays; i += 1) box(g, x + (w * i) / bays - 0.007, v, 0.006, 0.014, h, 0.018, fm);
  box(g, x - 0.007, v + h - 0.014, 0.006, w + 0.014, 0.014, 0.02, fm);
  box(g, x - 0.007, v, 0.006, w + 0.014, 0.012, 0.022, fm);
  if (transom) box(g, x, v + h * 0.78, 0.008, w, 0.01, 0.016, fm);
  return panes;
}

/** Deep picture window framed by a projecting surround (bronze, charcoal or concrete). */
export function framedWindow(parent, side, plane, u, v, w, h, { surround = LUX.charcoal, depth = 0.06, tint = LUX.glassTint, lit = null, material = null } = {}) {
  const { g, span } = wall(parent, side, plane);
  const x = span(u, w), t = 0.025;
  const sm = material ?? metal(surround);
  box(g, x - t, v - t, 0, w + 2 * t, t, depth, sm); box(g, x - t, v + h, 0, w + 2 * t, t, depth, sm);
  box(g, x - t, v, 0, t, h, depth, sm); box(g, x + w, v, 0, t, h, depth, sm);
  box(g, x, v, 0, w, h, 0.004, mat(0x27323a, { rough: 0.9 }));
  const pane = box(g, x, v, 0.006, w, h, 0.006, glass(tint));
  pane.userData.window = true;
  if (lit !== null) pane.userData.lit = lit;
  return pane;
}

/** Vertical (or horizontal) timber slat screen standing proud of a wall. */
export function slats(parent, side, plane, u, v, w, h, { gap = 0.035, size = 0.014, out = 0.03, color = LUX.walnut, horizontal = false } = {}) {
  const { g, span } = wall(parent, side, plane);
  const x = span(u, w);
  const m = woodMat(color);
  if (horizontal) {
    const n = Math.max(2, Math.floor(h / gap));
    for (let i = 0; i < n; i += 1) box(g, x, v + (h * i) / n, out, w, size, size * 1.6, m);
    box(g, x, v, 0, 0.012, h, out + 0.02, m); box(g, x + w - 0.012, v, 0, 0.012, h, out + 0.02, m);
  } else {
    const n = Math.max(2, Math.floor(w / gap));
    for (let i = 0; i <= n; i += 1) box(g, x + ((w - size) * i) / n, v, out, size, h, size * 1.8, m);
    box(g, x, v + h - 0.012, 0, w, 0.012, out + 0.025, m); box(g, x, v, 0, w, 0.012, out + 0.025, m);
  }
}

/** Free-standing vertical slat screen (gate, privacy screen) along X or Z. */
export function slatScreen(parent, x, z, length, h, axis, { gap = 0.03, size = 0.014, color = LUX.walnut } = {}) {
  const m = woodMat(color);
  const n = Math.max(2, Math.floor(length / gap));
  for (let i = 0; i <= n; i += 1) {
    const t = ((length - size) * i) / n;
    if (axis === 'x') box(parent, x + t, 0, z, size, h, size * 1.8, m); else box(parent, x, 0, z + t, size * 1.8, h, size, m);
  }
  if (axis === 'x') box(parent, x, h - 0.012, z - 0.005, length, 0.012, 0.035, metal()); else box(parent, x - 0.005, h - 0.012, z, 0.035, 0.012, length, metal());
}

/** Vertical fins (sun shading) on a wall, evenly spaced. */
export function fins(parent, side, plane, u, v, w, h, { count = 6, depth = 0.06, thick = 0.018, color = LUX.ivory, material = null } = {}) {
  const { g, span } = wall(parent, side, plane);
  const x = span(u, w);
  const m = material ?? mat(color, { rough: 0.55 });
  for (let i = 0; i < count; i += 1) box(g, x + ((w - thick) * i) / Math.max(1, count - 1), v, 0, thick, h, depth, m);
}

/** Stacked natural-stone feature wall (a solid block with stone texture and a capping). */
export function stoneWall(parent, x, z, w, h, d, { color = LUX.stone, cap = LUX.ivory } = {}) {
  box(parent, x, 0, z, w, h, d, stoneMat(color));
  box(parent, x - 0.006, h, z - 0.006, w + 0.012, 0.014, d + 0.012, mat(cap, { rough: 0.6 }));
}

/** Glass balustrade along X or Z with a slim top rail. */
export function glassRail(parent, x, y, z, length, axis, { h = 0.1, rail = LUX.charcoal } = {}) {
  const gm = new THREE.MeshPhysicalMaterial({ color: 0xd3e8ec, roughness: 0.05, transparent: true, opacity: 0.45 });
  if (axis === 'x') { box(parent, x, y, z, length, h, 0.01, gm); box(parent, x, y + h, z - 0.003, length, 0.008, 0.016, metal(rail)); }
  else { box(parent, x, y, z, 0.01, h, length, gm); box(parent, x - 0.003, y + h, z, 0.016, 0.008, length, metal(rail)); }
}

/** Slim modern pergola: two posts per side and a run of thin beams. */
export function slimPergola(parent, x, z, w, d, h, { color = LUX.charcoal, beams = 9, beamColor = LUX.oak, axis = 'x' } = {}) {
  const pm = metal(color);
  for (const [px, pz] of [[x, z], [x + w - 0.02, z], [x, z + d - 0.02], [x + w - 0.02, z + d - 0.02]]) box(parent, px, 0, pz, 0.02, h, 0.02, pm);
  box(parent, x, h, z, w, 0.02, 0.02, pm); box(parent, x, h, z + d - 0.02, w, 0.02, 0.02, pm);
  box(parent, x, h, z, 0.02, 0.02, d, pm); box(parent, x + w - 0.02, h, z, 0.02, 0.02, d, pm);
  const bm = woodMat(beamColor);
  for (let i = 0; i < beams; i += 1) {
    if (axis === 'x') box(parent, x + 0.01 + ((w - 0.03) * i) / (beams - 1), h + 0.02, z, 0.012, 0.03, d, bm);
    else box(parent, x, h + 0.02, z + 0.01 + ((d - 0.03) * i) / (beams - 1), w, 0.03, 0.012, bm);
  }
}

/** Ornamental grass clump: a soft mound of fine blades with paler plumes, the contemporary collections' planting. */
export function grass(parent, x, z, random, { scale = 1, color = 0x8fae62, tips = 0xe2d6a2 } = {}) {
  const blade = leafMat(color);
  const tip = mat(tips, { rough: 0.95 });
  // A low mound reads as foliage from the gameplay camera; blades and plumes give it texture up close.
  const mound = new THREE.Mesh(new THREE.IcosahedronGeometry(0.034 * scale, 1), blade);
  mound.scale.set(1, 0.75, 1); mound.position.set(x, 0.022 * scale, z); mound.castShadow = true; mound.receiveShadow = true; parent.add(mound);
  const n = 9;
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 + random() * 0.5;
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.012 * scale, 0.11 * scale * (0.85 + random() * 0.35), 4), i % 3 === 0 ? tip : blade);
    m.position.set(x + Math.cos(a) * 0.016 * scale, 0.055 * scale, z + Math.sin(a) * 0.016 * scale);
    m.rotation.z = Math.cos(a) * 0.45; m.rotation.x = -Math.sin(a) * 0.45;
    m.castShadow = true; parent.add(m);
  }
}

/** Clipped round shrub ball (box or pittosporum). */
export function shrubBall(parent, x, z, r = 0.045, color = 0x5f8a52) {
  sphere(parent, x, r * 0.9, z, r, leafMat(color), 2);
}

/** Multi-stem ornamental tree (olive, maple) with a soft layered canopy. */
export function multiStemTree(parent, x, z, random, { scale = 1, leaves = 0x7e9e62, trunk = 0x8b7d6b, stems = 3 } = {}) {
  const tm = mat(trunk, { rough: 0.9 });
  for (let i = 0; i < stems; i += 1) {
    const a = (i / stems) * Math.PI * 2 + random();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008 * scale, 0.012 * scale, 0.32 * scale, 6), tm);
    stem.position.set(x + Math.cos(a) * 0.02 * scale, 0.16 * scale, z + Math.sin(a) * 0.02 * scale);
    stem.rotation.z = Math.cos(a) * 0.2; stem.rotation.x = -Math.sin(a) * 0.2;
    stem.castShadow = true; parent.add(stem);
  }
  const lm = leafMat(leaves);
  for (let i = 0; i < 7; i += 1) {
    const a = random() * Math.PI * 2, r = (0.04 + random() * 0.06) * scale;
    sphere(parent, x + Math.cos(a) * r, (0.3 + random() * 0.1) * scale, z + Math.sin(a) * r, (0.06 + random() * 0.03) * scale, lm, 1);
  }
}

/** Tall slim columnar tree (Italian cypress / hornbeam column) for formal rhythm. */
export function columnTree(parent, x, z, { scale = 1, color = 0x56784a } = {}) {
  cylinder(parent, x, 0, z, 0.008 * scale, 0.01 * scale, 0.06 * scale, mat(0x6b5a46), 6);
  const lm = leafMat(color);
  // A tall clipped column: a stretched sphere with two softer tiers so it reads as foliage, not a post.
  for (const [y, r, sy] of [[0.2, 0.045, 2.6], [0.12, 0.042, 1.4], [0.3, 0.032, 1.6]]) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * scale, 2), lm);
    m.scale.set(1, sy, 1); m.position.set(x, y * scale, z); m.castShadow = true; m.receiveShadow = true; parent.add(m);
  }
}

/** Concrete or corten planter box with grasses and a shrub ball. */
export function planterBox(parent, x, z, w, d, random, { h = 0.07, color = LUX.concrete, plants = 'grass' } = {}) {
  box(parent, x, 0, z, w, h, d, concreteMat(color), 0.006);
  box(parent, x + 0.01, h - 0.004, z + 0.01, w - 0.02, 0.008, d - 0.02, mat(0x5b4634));
  const g = new THREE.Group(); g.position.y = h; parent.add(g);
  const n = Math.max(2, Math.round((w * d) / 0.006));
  for (let i = 0; i < n; i += 1) {
    const px = x + 0.025 + random() * (w - 0.05), pz = z + 0.025 + random() * (d - 0.05);
    if (plants === 'grass' || random() < 0.5) grass(g, px, pz, random, { scale: 0.75 }); else shrubBall(g, px, pz, 0.03);
  }
}

/** Large stepping stones along an axis on a lawn. */
export function steppingStones(parent, x, z, count, axis, { size = 0.09, gap = 0.04, color = LUX.sandstone } = {}) {
  const m = stoneMat(color);
  for (let i = 0; i < count; i += 1) {
    const t = i * (size + gap);
    if (axis === 'x') box(parent, x + t, 0, z, size, 0.012, size * 0.7, m, 0.004); else box(parent, x, 0, z + t, size * 0.7, 0.012, size, m, 0.004);
  }
}

/** Reflecting pool / lap pool: stone coping, dark-tiled water. */
export function pool(parent, x, z, w, d, { coping = LUX.sandstone, water = 0x5bb8c2, depth = 0.03 } = {}) {
  box(parent, x - 0.03, 0, z - 0.03, w + 0.06, depth, d + 0.06, stoneMat(coping), 0.004);
  box(parent, x, 0.006, z, w, depth, d, waterMat(water));
}

/** Outdoor lounge: low sofa and a coffee table on a deck. */
export function lounge(parent, x, z, { cushion = 0xe9e2d4, frame = LUX.charcoal, axis = 'x' } = {}) {
  const fm = metal(frame), cm = mat(cushion, { rough: 0.95, tex: 'fabric' });
  if (axis === 'x') {
    box(parent, x, 0.0, z, 0.2, 0.03, 0.07, fm); box(parent, x, 0.03, z, 0.2, 0.02, 0.07, cm); box(parent, x, 0.03, z, 0.2, 0.05, 0.018, cm);
    box(parent, x + 0.06, 0, z + 0.1, 0.08, 0.03, 0.05, mat(LUX.oak, { rough: 0.7 }));
  } else {
    box(parent, x, 0.0, z, 0.07, 0.03, 0.2, fm); box(parent, x, 0.03, z, 0.07, 0.02, 0.2, cm); box(parent, x, 0.03, z, 0.018, 0.05, 0.2, cm);
    box(parent, x + 0.1, 0, z + 0.06, 0.05, 0.03, 0.08, mat(LUX.oak, { rough: 0.7 }));
  }
}

/** Sun lounger pair with a side table. */
export function loungers(parent, x, z, count = 2, { cushion = 0xf2ede3, axis = 'z' } = {}) {
  for (let i = 0; i < count; i += 1) {
    const ox = axis === 'z' ? x + i * 0.1 : x, oz = axis === 'z' ? z : z + i * 0.1;
    const [w, d] = axis === 'z' ? [0.06, 0.16] : [0.16, 0.06];
    box(parent, ox, 0.012, oz, w, 0.02, d, mat(LUX.oak, { rough: 0.7 }), 0.004);
    box(parent, ox + 0.004, 0.032, oz + 0.004, w - 0.008, 0.01, d - 0.008, mat(cushion, { rough: 0.95, tex: 'fabric' }), 0.003);
  }
}

/** Low bollard light: charcoal post with a warm lit head (glows at night). */
export function bollardLight(parent, x, z, { h = 0.07 } = {}) {
  box(parent, x - 0.009, 0, z - 0.009, 0.018, h, 0.018, metal());
  const head = box(parent, x - 0.012, h - 0.022, z - 0.012, 0.024, 0.016, 0.024, mat(0xfff3d6, { emissive: 0x3a2a10 }));
  head.userData.lamp = true;
}

/** Architectural light line: a thin warm strip (soffit, step or wall wash) that glows at night. */
export function lightLine(parent, x, y, z, w, h, d) {
  const m = box(parent, x, y, z, w, h, d, mat(0xfff1d0, { emissive: 0x2a1e0c, rough: 0.4 }));
  m.userData.lamp = true;
  return m;
}

/** Minimal wall sconce (a slim box that glows). */
export function sconce(parent, side, plane, u, v) {
  const { g, span } = wall(parent, side, plane);
  const x = span(u, 0.02);
  box(g, x, v, 0, 0.02, 0.05, 0.02, metal());
  const glow = box(g, x + 0.002, v + 0.005, 0.02, 0.016, 0.04, 0.003, mat(0xfff3d6));
  glow.userData.lamp = true;
}

/** Concrete driveway with a parked car-sized pad and expansion joints. */
export function driveway(parent, x, z, w, d, { color = 0xd9d4ca, joints = 3 } = {}) {
  box(parent, x, 0, z, w, 0.01, d, concreteMat(color));
  for (let i = 1; i < joints; i += 1) box(parent, x, 0.01, z + (d * i) / joints, w, 0.002, 0.006, mat(0x9b968c));
}

/** Flat-roofed carport on slim columns. */
export function carport(parent, x, z, w, d, h = 0.22, { roof = LUX.ivory } = {}) {
  for (const [px, pz] of [[x + 0.02, z + 0.02], [x + w - 0.04, z + 0.02], [x + 0.02, z + d - 0.04], [x + w - 0.04, z + d - 0.04]]) box(parent, px, 0, pz, 0.02, h, 0.02, metal());
  slab(parent, x - 0.02, z - 0.02, x + w + 0.02, z + d + 0.02, h, { t: 0.035, color: roof });
}

/** Low modern boundary wall with a gap for the entrance; render or stone. */
export function boundaryWall(parent, x, z, length, axis, { h = 0.1, t = 0.04, material = null } = {}) {
  const m = material ?? renderMat(LUX.ivory);
  if (axis === 'x') box(parent, x, 0, z, length, h, t, m); else box(parent, x, 0, z, t, h, length, m);
}

/** Pivot entrance door (tall walnut or bronze panel with a vertical pull). */
export function pivotDoor(parent, side, plane, u, w, h, { color = LUX.walnut, frame = LUX.charcoal } = {}) {
  const { g, span } = wall(parent, side, plane);
  const x = span(u, w);
  box(g, x - 0.015, 0, 0, w + 0.03, h + 0.015, 0.025, metal(frame));
  box(g, x, 0, 0.015, w, h, 0.02, woodMat(color));
  box(g, x + w * 0.78, h * 0.25, 0.035, 0.008, h * 0.5, 0.01, bronze());
  box(g, x - 0.06, 0, 0, w + 0.12, 0.018, 0.12, stoneMat(LUX.sandstone));
}

/** Solar array on a flat roof (tilted panels in rows). */
export function solarPanels(parent, x, z, cols, rows, y, { tilt = 0.32, w = 0.11, d = 0.07 } = {}) {
  const pm = new THREE.MeshPhysicalMaterial({ color: 0x23334a, roughness: 0.15, metalness: 0.4, clearcoat: 1 });
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.008, d), pm);
    m.position.set(x + c * (w + 0.012) + w / 2, y + 0.03, z + r * (d + 0.04) + d / 2);
    m.rotation.x = -tilt; m.castShadow = true; parent.add(m);
    box(parent, x + c * (w + 0.012) + w / 2 - 0.004, y, z + r * (d + 0.04) + d * 0.7, 0.008, 0.03, 0.008, metal(0x9aa0a6));
  }
}

/** Skylight: a low glazed box on a flat roof. */
export function skylight(parent, x, z, w, d, y) {
  box(parent, x, y, z, w, 0.03, d, metal(0xd8d2c6));
  const pane = box(parent, x + 0.01, y + 0.03, z + 0.01, w - 0.02, 0.006, d - 0.02, glass(0xa9cdd6));
  pane.userData.window = true;
}

/** Roof garden: planted beds with grasses and shrubs inside an area, leaving a path. */
export function roofGarden(parent, x0, z0, x1, z1, y, random, { soil = 0x6b5440, lawn = true } = {}) {
  const g = new THREE.Group(); g.position.y = y; parent.add(g);
  if (lawn) box(g, x0, 0, z0, x1 - x0, 0.02, z1 - z0, mat(0x8fb070, { rough: 1, tex: 'grass' }));
  else box(g, x0, 0, z0, x1 - x0, 0.02, z1 - z0, mat(soil, { rough: 1 }));
  const inner = new THREE.Group(); inner.position.y = 0.02; g.add(inner);
  const n = Math.max(3, Math.round(((x1 - x0) * (z1 - z0)) / 0.02));
  for (let i = 0; i < n; i += 1) {
    const px = x0 + 0.03 + random() * (x1 - x0 - 0.06), pz = z0 + 0.03 + random() * (z1 - z0 - 0.06);
    if (random() < 0.6) grass(inner, px, pz, random, { scale: 0.8 }); else shrubBall(inner, px, pz, 0.028 + random() * 0.015);
  }
}

/** Deck boards (timber floor area) — terraces, pool decks, boardwalks. */
export function deck(parent, x, z, w, d, y = 0, { color = LUX.deck } = {}) {
  box(parent, x, y, z, w, 0.014, d, woodMat(color));
}

/** Paved terrace in large-format stone. */
export function terrace(parent, x, z, w, d, y = 0, { color = 0xe6dccb } = {}) {
  box(parent, x, y, z, w, 0.012, d, pavingMat(color));
}

/** Dining set: a timber table with four chairs, for terraces. */
export function diningSet(parent, x, z) {
  box(parent, x, 0, z, 0.12, 0.05, 0.07, mat(LUX.oak, { rough: 0.7 }));
  for (const [dx, dz] of [[-0.035, 0.015], [-0.035, 0.045], [0.125, 0.015], [0.125, 0.045]]) box(parent, x + dx, 0, z + dz - 0.01, 0.03, 0.035, 0.03, metal());
}

/** Palm or banana accent drawn from a small set (tropical courtyards). */
export function tropicalAccent(parent, x, z, random, kit) {
  const choice = pick(random, ['banana', 'fan', 'palm']);
  if (choice === 'banana') kit.bananaPlant(parent, x, z, random, { scale: 0.9 });
  else if (choice === 'fan') kit.fanPalm(parent, x, z, random, { scale: 0.85 });
  else kit.palm(parent, x, z, random, { scale: 0.9, lean: 0.12 });
}

export { P };
