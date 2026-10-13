// TINY CITY modeling kit: palette, materials and parametric building blocks used by every baked asset.
// Coordinates: 1 unit = 1 map tile. Grid x → scene +X, grid y → scene +Z, height → +Y. The camera looks from
// +X/+Z, so only the south (+Z) and east (+X) faces and the roofs are ever visible; detail goes there.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const PALETTE = {
  ivory: 0xfaf3e6, cream: 0xf3e6cf, sand: 0xe9d8b8, linen: 0xefe4d2,
  coral: 0xe88b74, terracotta: 0xc96f4f, clay: 0xb65f45, peach: 0xf1b38f,
  turquoise: 0x5fb0aa, teal: 0x3f8d8a, seafoam: 0x9fd3c7, sky: 0x8ec5d6,
  sage: 0xa3bb8c, leaf: 0x6f9e5c, forest: 0x4c7d53, moss: 0x587f45,
  timber: 0xa8754c, walnut: 0x7a5236, stone: 0xd2c7b2, slate: 0x6f7c84, charcoal: 0x3d464b,
  asphalt: 0x67737b, paving: 0xe2d9c6, curb: 0xc9bfac, gold: 0xf1c45f, white: 0xffffff,
  roofTerracotta: 0xc8674a, roofSlate: 0x5d6f78, roofTeal: 0x4f8b88, roofSand: 0xd9a066,
};

const cache = new Map();
/** Matte painted material; cached by color and options so the GPU shares programs. */
export function mat(color, { rough = 0.82, metal = 0, emissive = 0, flat = false } = {}) {
  const key = `${color}:${rough}:${metal}:${emissive}:${flat}`;
  if (!cache.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: flat });
    if (emissive) m.emissive = new THREE.Color(emissive);
    cache.set(key, m);
  }
  return cache.get(key);
}
/** Glass: glossy, slightly tinted, reflects the studio environment. Tagged so the night pass can light it. */
export function glass(tint = 0x9cc9d3) {
  const key = `glass:${tint}`;
  if (!cache.has(key)) {
    const m = new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.08, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.25 });
    m.userData.glass = true;
    cache.set(key, m);
  }
  return cache.get(key);
}

/** Deterministic RNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (random, list) => list[Math.floor(random() * list.length) % list.length];

function enable(mesh) { mesh.castShadow = true; mesh.receiveShadow = true; return mesh; }

/** Axis-aligned box from min corner (x, y, z) with size (w, h, d); optional rounded edges. */
export function box(parent, x, y, z, w, h, d, material, radius = 0) {
  const r = Math.min(radius, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const geometry = r > 0.001 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
  const mesh = enable(new THREE.Mesh(geometry, material));
  mesh.position.set(x + w / 2, y + h / 2, z + d / 2);
  parent.add(mesh);
  return mesh;
}
export function cylinder(parent, x, y, z, radiusTop, radiusBottom, h, material, segments = 16) {
  const mesh = enable(new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, h, segments), material));
  mesh.position.set(x, y + h / 2, z);
  parent.add(mesh);
  return mesh;
}
export function sphere(parent, x, y, z, radius, material, detail = 2) {
  const mesh = enable(new THREE.Mesh(new THREE.IcosahedronGeometry(radius, detail), material));
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** Lot plate: a thin slab that fills the footprint exactly (opaque, so it hides the shadow pass underneath). */
export function plate(parent, w, d, color, h = 0.04) {
  // Top face at y = 0 so paths, beds and decals placed at y >= 0 always sit on top of it.
  return box(parent, 0, -h, 0, w, h, d, mat(color, { rough: 0.95 }));
}

/**
 * Pitched roof with real thickness and overhang. `ridge` 'x' runs the ridge along X. `hip` slopes all four sides.
 * Built from the eave rectangle (x0, z0)–(x1, z1) at height y, rising by `rise`.
 */
export function roof(parent, { x0, z0, x1, z1, y, rise, color, ridge = 'x', hip = false, thickness = 0.05, gableColor }) {
  const group = new THREE.Group();
  const ridgeX = ridge === 'x';
  const half = ridgeX ? (z1 - z0) / 2 : (x1 - x0) / 2;
  const inset = hip ? half : 0;
  const top = y + rise;
  const r1 = ridgeX ? new THREE.Vector3(x0 + inset, top, (z0 + z1) / 2) : new THREE.Vector3((x0 + x1) / 2, top, z0 + inset);
  const r2 = ridgeX ? new THREE.Vector3(x1 - inset, top, (z0 + z1) / 2) : new THREE.Vector3((x0 + x1) / 2, top, z1 - inset);
  const c00 = new THREE.Vector3(x0, y, z0), c10 = new THREE.Vector3(x1, y, z0), c11 = new THREE.Vector3(x1, y, z1), c01 = new THREE.Vector3(x0, y, z1);
  const faces = ridgeX
    ? [[c01, c11, r2, r1], [c10, c00, r1, r2], hip ? [c00, c01, r1] : null, hip ? [c11, c10, r2] : null]
    : [[c00, c01, r2, r1], [c11, c10, r1, r2], hip ? [c10, c00, r1] : null, hip ? [c01, c11, r2] : null];
  const positions = [];
  for (const face of faces) {
    if (!face) continue;
    const tri = (a, b, c) => positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    if (face.length === 4) { tri(face[0], face[1], face[2]); tri(face[0], face[2], face[3]); } else tri(face[0], face[1], face[2]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const roofMat = mat(color, { rough: 0.7, flat: true });
  const surface = enable(new THREE.Mesh(geometry, roofMat));
  surface.material = roofMat;
  surface.material.side = THREE.DoubleSide;
  group.add(surface);
  // Fascia band gives the eave a visible edge thickness.
  const fascia = mat(0xf7efe0, { rough: 0.8 });
  box(group, x0, y - thickness, z0, x1 - x0, thickness, 0.03, fascia);
  box(group, x0, y - thickness, z1 - 0.03, x1 - x0, thickness, 0.03, fascia);
  box(group, x0, y - thickness, z0, 0.03, thickness, z1 - z0, fascia);
  box(group, x1 - 0.03, y - thickness, z0, 0.03, thickness, z1 - z0, fascia);
  // Tile courses: shallow ribs parallel to the eave on the two visible slopes.
  const rib = mat(new THREE.Color(color).multiplyScalar(0.82).getHex(), { rough: 0.75 });
  for (let i = 1; i < 4; i += 1) {
    const t = i / 4;
    const lerp = (a, b) => a.clone().lerp(b, t);
    const pairs = ridgeX ? [[lerp(c01, r1), lerp(c11, r2)]] : [[lerp(c10, r1), lerp(c11, r2)]];
    for (const [a, b] of pairs) {
      const length = a.distanceTo(b);
      const ribMesh = enable(new THREE.Mesh(new THREE.BoxGeometry(length, 0.012, 0.018), rib));
      ribMesh.position.copy(a.clone().add(b).multiplyScalar(0.5));
      ribMesh.lookAt(b); ribMesh.rotateY(Math.PI / 2);
      ribMesh.position.y += 0.006;
      group.add(ribMesh);
    }
  }
  // Ridge cap.
  const capLength = r1.distanceTo(r2);
  if (capLength > 0.01) {
    const cap = enable(new THREE.Mesh(new THREE.BoxGeometry(ridgeX ? capLength + 0.04 : 0.06, 0.04, ridgeX ? 0.06 : capLength + 0.04), mat(new THREE.Color(color).multiplyScalar(0.78).getHex())));
    cap.position.copy(r1.clone().add(r2).multiplyScalar(0.5));
    group.add(cap);
  }
  // Gable end walls (non-hip): triangles in the wall color under the visible gable.
  if (!hip && gableColor !== undefined) {
    const tri = new THREE.BufferGeometry();
    const a = ridgeX ? [new THREE.Vector3(x1 - 0.1, y, z0 + 0.1), new THREE.Vector3(x1 - 0.1, y, z1 - 0.1), new THREE.Vector3(x1 - 0.1, top - 0.06, (z0 + z1) / 2)]
      : [new THREE.Vector3(x0 + 0.1, y, z1 - 0.1), new THREE.Vector3(x1 - 0.1, y, z1 - 0.1), new THREE.Vector3((x0 + x1) / 2, top - 0.06, z1 - 0.1)];
    tri.setAttribute('position', new THREE.Float32BufferAttribute(a.flatMap((v) => [v.x, v.y, v.z]), 3));
    tri.computeVertexNormals();
    const gm = mat(gableColor).clone(); gm.side = THREE.DoubleSide;
    group.add(enable(new THREE.Mesh(tri, gm)));
  }
  parent.add(group);
  return { top, r1, r2 };
}

/**
 * Wall frame: returns a group whose local frame has the wall plane at z = 0 with +z pointing outside, +y up and
 * x along the wall. `span(u, w)` converts a world span u..u+w along the wall (x for south/north walls, z for
 * east/west walls) into the local x where that span starts. Lets every facade element work on any side.
 */
export function wall(parent, side, plane) {
  const g = new THREE.Group();
  const flip = side === 'north' || side === 'east';
  if (side === 'south') g.position.set(0, 0, plane);
  if (side === 'north') { g.position.set(0, 0, plane); g.rotation.y = Math.PI; }
  if (side === 'east') { g.position.set(plane, 0, 0); g.rotation.y = Math.PI / 2; }
  if (side === 'west') { g.position.set(plane, 0, 0); g.rotation.y = -Math.PI / 2; }
  parent.add(g);
  return { g, span: (u, w) => (flip ? -(u + w) : u) };
}

/** Recessed window: frame proud of the wall, glass set back, stone sill, optional shutters. */
export function windowOn(parent, side, plane, u, v, w, h, { frame = PALETTE.white, tint = 0x9cc9d3, shutters = null, sill = true, mullion = true, lit = null } = {}) {
  const { g, span } = wall(parent, side, plane);
  const x = span(u, w), f = 0.024;
  const frameMat = mat(frame, { rough: 0.6 });
  // Walls are solid boxes, so the recess is built outward: dark reveal, glass, then a deep frame around it.
  box(g, x - f, v - f, 0, w + 2 * f, f, 0.045, frameMat);
  box(g, x - f, v + h, 0, w + 2 * f, f, 0.045, frameMat);
  box(g, x - f, v, 0, f, h, 0.045, frameMat);
  box(g, x + w, v, 0, f, h, 0.045, frameMat);
  box(g, x, v, 0, w, h, 0.004, mat(0x2d3b44, { rough: 0.9 }));
  const pane = box(g, x, v, 0.004, w, h, 0.006, glass(tint));
  pane.userData.window = true;
  if (lit !== null) pane.userData.lit = lit;
  if (mullion) { box(g, x + w / 2 - 0.006, v, 0.008, 0.012, h, 0.014, frameMat); if (h > w * 1.3) box(g, x, v + h * 0.55, 0.008, w, 0.012, 0.014, frameMat); }
  if (sill) box(g, x - f * 1.6, v - f * 1.9, 0, w + f * 3.2, f * 0.9, 0.07, mat(PALETTE.stone));
  if (shutters) {
    const sm = mat(shutters, { rough: 0.7 });
    box(g, x - f - w * 0.34, v, 0, w * 0.3, h, 0.02, sm);
    box(g, x + w + f + w * 0.04, v, 0, w * 0.3, h, 0.02, sm);
    for (const sx of [x - f - w * 0.34, x + w + f + w * 0.04]) for (let i = 1; i < 5; i += 1) box(g, sx, v + h * i / 5, 0.02, w * 0.3, 0.006, 0.006, mat(new THREE.Color(shutters).multiplyScalar(0.8).getHex()));
  }
  return pane;
}

/** Glazed shopfront bay with a stall riser, for townhouse ground floors and cafes. */
export function shopfrontOn(parent, side, plane, u, w, h, { frame = PALETTE.charcoal, tint = 0xb5d6dc, lit = true } = {}) {
  const { g, span } = wall(parent, side, plane);
  const x = span(u, w);
  const fm = mat(frame, { rough: 0.45, metal: 0.3 });
  box(g, x - 0.02, 0, 0, w + 0.04, 0.06, 0.05, fm);
  box(g, x - 0.02, h, 0, w + 0.04, 0.03, 0.05, fm);
  box(g, x - 0.02, 0, 0, 0.025, h, 0.05, fm);
  box(g, x + w - 0.005, 0, 0, 0.025, h, 0.05, fm);
  box(g, x, 0.06, 0, w, h - 0.06, 0.004, mat(0x3a3530, { rough: 0.9 }));
  const pane = box(g, x, 0.06, 0.004, w, h - 0.06, 0.006, glass(tint));
  pane.userData.window = true; pane.userData.lit = lit;
  const bays = Math.max(2, Math.round(w / 0.14));
  for (let i = 1; i < bays; i += 1) box(g, x + (w * i) / bays - 0.006, 0.06, 0.008, 0.012, h - 0.06, 0.02, fm);
  return pane;
}

/** Door with frame, step and optional canopy. */
export function doorOn(parent, side, plane, u, w, h, { color = PALETTE.walnut, frame = PALETTE.white, canopy = null, glazed = false } = {}) {
  const { g, span } = wall(parent, side, plane);
  const x = span(u, w);
  box(g, x - 0.03, 0, 0, w + 0.06, h + 0.03, 0.03, mat(frame));
  box(g, x, 0, 0.012, w, h, 0.02, mat(color, { rough: 0.55 }));
  if (glazed) { const pane = box(g, x + w * 0.2, h * 0.45, 0.03, w * 0.6, h * 0.42, 0.006, glass(0xbfdde2)); pane.userData.window = true; pane.userData.lit = true; }
  box(g, x + w * 0.8, h * 0.45, 0.03, 0.02, 0.02, 0.02, mat(PALETTE.gold, { rough: 0.3, metal: 0.6 }));
  if (canopy) {
    box(g, x - 0.08, h + 0.05, 0, w + 0.16, 0.035, 0.17, mat(canopy, { rough: 0.6 }));
    box(g, x - 0.06, 0, 0.13, 0.02, h + 0.05, 0.02, mat(frame));
    box(g, x + w + 0.04, 0, 0.13, 0.02, h + 0.05, 0.02, mat(frame));
  }
  box(g, x - 0.07, 0, 0, w + 0.14, 0.03, 0.1, mat(PALETTE.stone));
}

/** Striped fabric awning projecting from the wall at height v. */
export function awningOn(parent, side, plane, u, w, v, { colors = [PALETTE.coral, PALETTE.ivory], depth = 0.22, drop = 0.12, stripes = 7 } = {}) {
  const { g, span } = wall(parent, side, plane);
  const x = span(u, w);
  const slope = Math.atan2(drop, depth), length = Math.hypot(depth, drop), sw = w / stripes;
  for (let i = 0; i < stripes; i += 1) {
    const m = mat(colors[i % colors.length], { rough: 0.9 });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.012, length), m);
    strip.castShadow = true; strip.receiveShadow = true;
    strip.position.set(x + sw * (i + 0.5), v - drop / 2, depth / 2);
    strip.rotation.x = slope;
    g.add(strip);
    box(g, x + sw * i + sw * 0.04, v - drop - 0.05, depth - 0.006, sw * 0.92, 0.05, 0.01, m);
  }
  box(g, x, v - 0.01, 0, w, 0.02, 0.02, mat(PALETTE.charcoal));
}

/** Balcony slab with a glass or bar railing. */
export function balconyOn(parent, side, plane, u, w, v, { depth = 0.18, railing = 'glass', color = PALETTE.ivory } = {}) {
  const { g, span } = wall(parent, side, plane);
  const x = span(u, w);
  box(g, x, v, 0, w, 0.035, depth, mat(color));
  const rail = mat(PALETTE.charcoal, { rough: 0.4, metal: 0.4 });
  if (railing === 'glass') {
    const gm = new THREE.MeshPhysicalMaterial({ color: 0xcfe6ea, roughness: 0.05, transparent: true, opacity: 0.5 });
    box(g, x, v + 0.035, depth - 0.012, w, 0.12, 0.012, gm);
    box(g, x, v + 0.035, 0, 0.012, 0.12, depth, gm);
    box(g, x + w - 0.012, v + 0.035, 0, 0.012, 0.12, depth, gm);
    box(g, x, v + 0.155, depth - 0.02, w, 0.015, 0.025, rail);
  } else {
    box(g, x, v + 0.15, depth - 0.02, w, 0.015, 0.02, rail);
    const posts = Math.max(3, Math.round(w / 0.05));
    for (let i = 0; i <= posts; i += 1) box(g, x + (w - 0.01) * i / posts, v + 0.035, depth - 0.015, 0.01, 0.12, 0.01, rail);
    box(g, x, v + 0.15, 0, 0.012, 0.015, depth, rail); box(g, x + w - 0.012, v + 0.15, 0, 0.012, 0.015, depth, rail);
  }
}

/** Projecting band course / cornice along a wall. */
export function bandOn(parent, side, plane, u, w, v, { h = 0.035, out = 0.03, color = PALETTE.ivory } = {}) {
  const { g, span } = wall(parent, side, plane);
  box(g, span(u, w) - out, v, -0.01, w + 2 * out, h, out + 0.01, mat(color, { rough: 0.7 }));
}

/** Flower box / planter with shrub and blossoms. */
export function planter(parent, x, z, w, d, random, { box: boxColor = PALETTE.timber, h = 0.08, blossoms = [PALETTE.coral, PALETTE.gold, 0xf4a6b8] } = {}) {
  box(parent, x, 0, z, w, h, d, mat(boxColor, { rough: 0.85 }), 0.012);
  box(parent, x + 0.01, h - 0.005, z + 0.01, w - 0.02, 0.01, d - 0.02, mat(0x6b4e36));
  const n = Math.max(2, Math.round((w * d) / 0.012));
  for (let i = 0; i < n; i += 1) {
    const px = x + 0.04 + random() * (w - 0.08), pz = z + 0.04 + random() * (d - 0.08);
    sphere(parent, px, h + 0.03, pz, 0.035 + random() * 0.02, mat(pick(random, [PALETTE.leaf, PALETTE.moss, 0x7fae69])), 1);
    if (random() < 0.6) sphere(parent, px + 0.01, h + 0.06, pz + 0.01, 0.014, mat(pick(random, blossoms), { rough: 0.6 }), 0);
  }
}

/** Trimmed hedge segment along X or Z. */
export function hedge(parent, x, z, length, axis, { h = 0.12, w = 0.1, color = PALETTE.forest } = {}) {
  if (axis === 'x') box(parent, x, 0, z, length, h, w, mat(color, { rough: 0.95 }), 0.035);
  else box(parent, x, 0, z, w, h, length, mat(color, { rough: 0.95 }), 0.035);
}

/** Soft organic blob (jittered icosphere) for canopies and shrubs. */
function blob(radius, random, detail = 2, squash = 1) {
  const geometry = new THREE.IcosahedronGeometry(radius, detail);
  const p = geometry.attributes.position;
  const seed = random() * 100;
  for (let i = 0; i < p.count; i += 1) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 9 + seed) * Math.cos(v.y * 7 + seed * 1.3) * Math.sin(v.z * 8 - seed);
    v.multiplyScalar(1 + n * 0.09);
    v.y *= squash;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

const LEAF_SETS = {
  round: [0x5f9654, 0x6fa95e, 0x83b86a],
  deep: [0x3f7550, 0x4f8a5c, 0x63a06c],
  autumn: [0xd98b4b, 0xe7a957, 0xc76f3e],
  blossom: [0xef9fb0, 0xf6b9c4, 0xe58ba0],
  olive: [0x7d9a5b, 0x93ad6b, 0xa8bf7e],
};

/** Deciduous / flowering tree. `scale` ~1 is a mature street tree (about 0.9 tiles tall). */
export function broadleaf(parent, x, z, random, { scale = 1, leaves = 'round' } = {}) {
  const g = new THREE.Group();
  const trunkH = 0.32 * scale;
  cylinder(g, 0, 0, 0, 0.028 * scale, 0.04 * scale, trunkH + 0.12 * scale, mat(PALETTE.walnut), 8);
  const colors = LEAF_SETS[leaves] ?? LEAF_SETS.round;
  const clusters = 5 + Math.floor(random() * 3);
  for (let i = 0; i < clusters; i += 1) {
    const a = (i / clusters) * Math.PI * 2 + random();
    const r = i === 0 ? 0 : 0.11 * scale * (0.6 + random() * 0.5);
    const y = trunkH + 0.16 * scale + (i === 0 ? 0.08 * scale : (random() - 0.3) * 0.12 * scale);
    const radius = (i === 0 ? 0.2 : 0.13 + random() * 0.05) * scale;
    const m = mat(colors[i % colors.length], { rough: 0.9 });
    const mesh = enable(new THREE.Mesh(blob(radius, random, 2, 0.92), m));
    mesh.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    g.add(mesh);
  }
  g.position.set(x, 0, z);
  parent.add(g);
  return g;
}

/** Slim Italian cypress. */
export function cypress(parent, x, z, random, { scale = 1 } = {}) {
  const g = new THREE.Group();
  cylinder(g, 0, 0, 0, 0.02 * scale, 0.025 * scale, 0.08 * scale, mat(PALETTE.walnut), 6);
  const m = mat(pick(random, [0x3e6d4a, 0x467a52]), { rough: 0.95 });
  const mesh = enable(new THREE.Mesh(blob(0.1 * scale, random, 2, 3.6), m));
  mesh.position.set(0, 0.42 * scale, 0);
  g.add(mesh);
  g.position.set(x, 0, z);
  parent.add(g);
  return g;
}

/** Coconut palm with a curved, ringed trunk and drooping fronds. */
export function palm(parent, x, z, random, { scale = 1, lean = 0.25 } = {}) {
  const g = new THREE.Group();
  const segments = 7;
  const height = 0.95 * scale;
  const dir = random() * Math.PI * 2;
  let top = new THREE.Vector3();
  const trunkMat = mat(0x9b7a55, { rough: 0.95 });
  const ringMat = mat(0x7d5f42, { rough: 0.95 });
  for (let i = 0; i < segments; i += 1) {
    const t0 = i / segments, t1 = (i + 1) / segments;
    const p0 = new THREE.Vector3(Math.cos(dir) * lean * t0 * t0 * scale, height * t0, Math.sin(dir) * lean * t0 * t0 * scale);
    const p1 = new THREE.Vector3(Math.cos(dir) * lean * t1 * t1 * scale, height * t1, Math.sin(dir) * lean * t1 * t1 * scale);
    const len = p0.distanceTo(p1);
    const seg = enable(new THREE.Mesh(new THREE.CylinderGeometry(0.022 * scale * (1 - t1 * 0.3), 0.026 * scale * (1 - t0 * 0.3), len, 8), i % 2 ? trunkMat : ringMat));
    seg.position.copy(p0.clone().add(p1).multiplyScalar(0.5));
    seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
    g.add(seg);
    top = p1;
  }
  const frondMat = mat(pick(random, [0x4f9a5a, 0x5aa463, 0x468c52]), { rough: 0.85 });
  frondMat.side = THREE.DoubleSide;
  const fronds = 9;
  for (let i = 0; i < fronds; i += 1) {
    const angle = (i / fronds) * Math.PI * 2 + random() * 0.4;
    const length = (0.36 + random() * 0.08) * scale;
    // A frond is a tapered strip bent downward along its length.
    const steps = 8;
    const positions = [];
    const width = 0.075 * scale;
    for (let s = 0; s < steps; s += 1) {
      const t0 = s / steps, t1 = (s + 1) / steps;
      const w0 = width * Math.sin(Math.PI * Math.min(1, t0 * 1.15 + 0.08)), w1 = width * Math.sin(Math.PI * Math.min(1, t1 * 1.15 + 0.08));
      const y0 = 0.06 * scale * t0 - 0.3 * scale * t0 * t0, y1 = 0.06 * scale * t1 - 0.3 * scale * t1 * t1;
      const a0 = [t0 * length, y0, -w0 / 2], b0 = [t0 * length, y0 - w0 * 0.25, w0 / 2];
      const a1 = [t1 * length, y1, -w1 / 2], b1 = [t1 * length, y1 - w1 * 0.25, w1 / 2];
      const c0 = [t0 * length, y0 + w0 * 0.12, 0], c1 = [t1 * length, y1 + w1 * 0.12, 0];
      positions.push(...a0, ...c0, ...c1, ...a0, ...c1, ...a1, ...c0, ...b0, ...b1, ...c0, ...b1, ...c1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const frond = enable(new THREE.Mesh(geometry, frondMat));
    frond.position.copy(top);
    frond.rotation.y = angle;
    g.add(frond);
  }
  for (let i = 0; i < 3; i += 1) sphere(g, top.x + Math.cos(i * 2.1) * 0.025 * scale, top.y - 0.03 * scale, top.z + Math.sin(i * 2.1) * 0.025 * scale, 0.022 * scale, mat(0x6b5a2e), 1);
  g.position.set(x, 0, z);
  parent.add(g);
  return g;
}

/** Rounded shrub. */
export function shrub(parent, x, z, random, { scale = 1, color = null, flowers = null } = {}) {
  const m = mat(color ?? pick(random, [0x4f8a5c, 0x5f9654, 0x3f7550]), { rough: 0.95 });
  const mesh = enable(new THREE.Mesh(blob(0.09 * scale, random, 2, 0.8), m));
  mesh.position.set(x, 0.06 * scale, z);
  parent.add(mesh);
  if (flowers) for (let i = 0; i < 6; i += 1) {
    const a = random() * Math.PI * 2, r = 0.06 * scale;
    sphere(parent, x + Math.cos(a) * r, 0.09 * scale + random() * 0.04 * scale, z + Math.sin(a) * r, 0.016 * scale, mat(flowers, { rough: 0.6 }), 0);
  }
}

/** Flowerbed: a soil bed edged in stone with dense blossoms. */
export function flowerbed(parent, x, z, w, d, random, colors = [PALETTE.coral, PALETTE.gold, 0xf4a6b8, 0xb9a3e3, PALETTE.ivory]) {
  box(parent, x, 0, z, w, 0.03, d, mat(PALETTE.stone), 0.01);
  box(parent, x + 0.02, 0.025, z + 0.02, w - 0.04, 0.012, d - 0.04, mat(0x6e5139, { rough: 1 }));
  const n = Math.round(w * d * 260);
  for (let i = 0; i < n; i += 1) {
    const px = x + 0.04 + random() * (w - 0.08), pz = z + 0.04 + random() * (d - 0.08);
    sphere(parent, px, 0.05, pz, 0.022, mat(pick(random, [0x5f9654, 0x6fa95e]), { rough: 0.95 }), 0);
    sphere(parent, px, 0.07, pz, 0.014, mat(pick(random, colors), { rough: 0.6 }), 0);
  }
}

/** Paved path segment (flush with the lot). */
export function path(parent, x, z, w, d, color = PALETTE.paving) {
  box(parent, x, 0, z, w, 0.012, d, mat(color, { rough: 0.95 }));
}

/** Classic street lamp. The lamp head is tagged so the night pass lights it. */
export function streetLamp(parent, x, z, { height = 0.62 } = {}) {
  const g = new THREE.Group();
  const iron = mat(0x34433f, { rough: 0.45, metal: 0.5 });
  cylinder(g, 0, 0, 0, 0.022, 0.03, 0.05, iron, 10);
  cylinder(g, 0, 0.05, 0, 0.011, 0.014, height - 0.05, iron, 8);
  const head = enable(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.06, 6), mat(0xfff1c8, { rough: 0.3, emissive: 0x332a10 })));
  head.position.set(0, height + 0.03, 0);
  head.userData.lamp = true;
  g.add(head);
  cylinder(g, 0, height + 0.06, 0, 0.012, 0.055, 0.025, iron, 6);
  cylinder(g, 0, height + 0.085, 0, 0.004, 0.004, 0.03, iron, 4);
  g.position.set(x, 0, z);
  parent.add(g);
  return g;
}

export function bench(parent, x, z, axis = 'x') {
  const g = new THREE.Group();
  const wood = mat(PALETTE.timber, { rough: 0.8 }), iron = mat(PALETTE.charcoal, { rough: 0.5, metal: 0.4 });
  const L = 0.2;
  if (axis === 'x') {
    box(g, -L / 2, 0.05, -0.03, L, 0.015, 0.06, wood);
    box(g, -L / 2, 0.065, -0.035, L, 0.05, 0.012, wood);
    box(g, -L / 2 + 0.01, 0, -0.03, 0.012, 0.05, 0.06, iron);
    box(g, L / 2 - 0.022, 0, -0.03, 0.012, 0.05, 0.06, iron);
  } else {
    box(g, -0.03, 0.05, -L / 2, 0.06, 0.015, L, wood);
    box(g, -0.035, 0.065, -L / 2, 0.012, 0.05, L, wood);
    box(g, -0.03, 0, -L / 2 + 0.01, 0.06, 0.05, 0.012, iron);
    box(g, -0.03, 0, L / 2 - 0.022, 0.06, 0.05, 0.012, iron);
  }
  g.position.set(x, 0, z);
  parent.add(g);
}

/** Patio umbrella with a small table. */
export function umbrella(parent, x, z, color = PALETTE.coral) {
  const g = new THREE.Group();
  cylinder(g, 0, 0, 0, 0.006, 0.006, 0.3, mat(PALETTE.ivory), 6);
  const canopy = enable(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.06, 8, 1, true), mat(color, { rough: 0.85 })));
  canopy.material.side = THREE.DoubleSide;
  canopy.position.set(0, 0.31, 0);
  g.add(canopy);
  cylinder(g, 0, 0, 0, 0.05, 0.05, 0.012, mat(PALETTE.ivory), 12).position.y = 0.11;
  cylinder(g, 0, 0, 0, 0.008, 0.008, 0.11, mat(PALETTE.charcoal), 6);
  g.position.set(x, 0, z);
  parent.add(g);
}
