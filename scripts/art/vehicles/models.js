// Phase 6 vehicles: original stylized models (compact, sedan, SUV, delivery van, city bus) and the bus-stop shelter.
// Units: 1 = one map tile. Every vehicle is built nose towards +X, centred on the origin, wheels on y = 0, and tags
// each mesh with `userData.layer`: 'body' (white paint, tinted per vehicle at runtime), 'detail' (glass, wheels,
// trim, lamp lenses: drawn as baked) and 'light' (lamp lenses that glow at night).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const materials = new Map();
function material(key, make) {
  if (!materials.has(key)) materials.set(key, make());
  return materials.get(key);
}
/** Car paint: near-white so a runtime tint gives the final colour; clearcoat for a soft premium sheen. */
const paint = () => material('paint', () => new THREE.MeshPhysicalMaterial({ color: 0xf2f2f2, roughness: 0.32, metalness: 0.05, clearcoat: 0.9, clearcoatRoughness: 0.18, envMapIntensity: 1.1 }));
const glassMat = () => material('glass', () => new THREE.MeshPhysicalMaterial({ color: 0x2c3f4c, roughness: 0.06, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6 }));
const trim = (color = 0x2f3437, rough = 0.6) => material(`trim:${color}:${rough}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.15 }));
const chrome = () => material('chrome', () => new THREE.MeshStandardMaterial({ color: 0xd9dde0, roughness: 0.22, metalness: 0.85 }));
const tyre = () => material('tyre', () => new THREE.MeshStandardMaterial({ color: 0x1f2326, roughness: 0.9 }));
const hub = () => material('hub', () => new THREE.MeshStandardMaterial({ color: 0xc9ced1, roughness: 0.35, metalness: 0.7 }));
const lamp = (color) => material(`lamp:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.1, emissive: new THREE.Color(color).multiplyScalar(0.15) }));

function add(parent, geometry, mat, layer, x, y, z) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(x, y, z);
  mesh.userData.layer = layer;
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
/** Rounded box centred at (x, y, z). */
const rbox = (parent, w, h, d, r, mat, layer, x, y, z, segments = 3) =>
  add(parent, new RoundedBoxGeometry(w, h, d, segments, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)), mat, layer, x, y, z);

function wheel(parent, x, z, radius, width) {
  const tyreGeo = new THREE.CylinderGeometry(radius, radius, width, 20);
  tyreGeo.rotateX(Math.PI / 2);
  add(parent, tyreGeo, tyre(), 'detail', x, radius, z);
  const hubGeo = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.004, 16);
  hubGeo.rotateX(Math.PI / 2);
  add(parent, hubGeo, hub(), 'detail', x, radius, z);
}

/**
 * Shared car body: a softly rounded lower shell, a glass greenhouse with a painted roof, bumpers, lamps and wheels.
 * `spec` sizes everything in tiles.
 */
function car(spec) {
  const g = new THREE.Group();
  const { L, W, ride, shell, cabinFront, cabinRear, cabinH, roof, wheelR } = spec;
  const half = L / 2;
  // Lower body.
  rbox(g, L, shell, W, Math.min(0.07, shell * 0.45), paint(), 'body', 0, ride + shell / 2, 0, 4);
  // Greenhouse (glass) and roof.
  const cabinL = cabinFront - cabinRear, cabinX = (cabinFront + cabinRear) / 2;
  rbox(g, cabinL, cabinH, W * 0.86, 0.045, glassMat(), 'detail', cabinX, ride + shell + cabinH / 2 - 0.004, 0, 3);
  // Pillars and roof in body paint (the window line reads clearly against the glass).
  rbox(g, cabinL * (roof ?? 0.92), 0.022, W * 0.84, 0.01, paint(), 'body', cabinX - cabinL * 0.02, ride + shell + cabinH + 0.006, 0, 2);
  rbox(g, 0.018, cabinH * 0.9, W * 0.87, 0.006, paint(), 'body', cabinX, ride + shell + cabinH * 0.45, 0, 1);
  // Bumpers.
  rbox(g, 0.03, shell * 0.42, W * 0.96, 0.012, trim(0x3a4044), 'detail', half - 0.012, ride + shell * 0.24, 0, 2);
  rbox(g, 0.03, shell * 0.42, W * 0.96, 0.012, trim(0x3a4044), 'detail', -half + 0.012, ride + shell * 0.24, 0, 2);
  // Headlights (warm white) and tail lights (red), on both corners.
  for (const side of [-1, 1]) {
    add(g, new THREE.BoxGeometry(0.012, 0.03, W * 0.2), lamp(0xfff3d6), 'light', half - 0.002, ride + shell * 0.68, side * W * 0.32);
    add(g, new THREE.BoxGeometry(0.012, 0.026, W * 0.22), lamp(0xe2453c), 'light', -half + 0.002, ride + shell * 0.7, side * W * 0.31);
    // Mirrors.
    rbox(g, 0.018, 0.016, 0.03, 0.006, paint(), 'body', cabinFront - 0.03, ride + shell + 0.02, side * (W / 2 + 0.008), 1);
  }
  // Door seam and a chrome sill accent along the visible side.
  for (const side of [-1, 1]) add(g, new THREE.BoxGeometry(L * 0.62, 0.006, 0.004), chrome(), 'detail', -0.01, ride + shell * 0.3, side * (W / 2 + 0.001));
  const axle = L * 0.32;
  for (const x of [axle, -axle]) for (const side of [-1, 1]) wheel(g, x, side * (W / 2 - 0.02), wheelR, 0.042);
  return g;
}

function van() {
  const g = new THREE.Group();
  const L = 0.58, W = 0.28, ride = 0.035, H = 0.27, half = L / 2;
  // One-box body with a short sloped nose.
  rbox(g, L * 0.8, H, W, 0.05, paint(), 'body', -L * 0.1, ride + H / 2, 0, 4);
  rbox(g, L * 0.24, H * 0.55, W, 0.05, paint(), 'body', half - L * 0.12, ride + H * 0.28, 0, 4);
  // Windscreen and side windows only at the front (cargo body behind).
  rbox(g, 0.06, H * 0.36, W * 0.9, 0.02, glassMat(), 'detail', L * 0.29, ride + H * 0.72, 0, 2);
  for (const side of [-1, 1]) {
    add(g, new THREE.BoxGeometry(0.1, H * 0.3, 0.006), glassMat(), 'detail', L * 0.2, ride + H * 0.72, side * (W / 2 + 0.002));
    add(g, new THREE.BoxGeometry(0.012, 0.028, W * 0.2), lamp(0xfff3d6), 'light', half - 0.004, ride + H * 0.3, side * W * 0.32);
    add(g, new THREE.BoxGeometry(0.012, 0.05, W * 0.12), lamp(0xe2453c), 'light', -half + 0.002, ride + H * 0.55, side * W * 0.38);
    // A pale stripe along the cargo box (the tint keeps it lighter than the body).
    add(g, new THREE.BoxGeometry(L * 0.5, 0.02, 0.004), trim(0xf7f3ea, 0.5), 'detail', -L * 0.12, ride + H * 0.5, side * (W / 2 + 0.002));
  }
  rbox(g, 0.03, 0.05, W * 0.96, 0.012, trim(0x3a4044), 'detail', half - 0.01, ride + 0.03, 0, 2);
  rbox(g, 0.03, 0.05, W * 0.96, 0.012, trim(0x3a4044), 'detail', -half + 0.01, ride + 0.03, 0, 2);
  for (const x of [L * 0.3, -L * 0.3]) for (const side of [-1, 1]) wheel(g, x, side * (W / 2 - 0.02), 0.058, 0.045);
  return g;
}

function bus() {
  const g = new THREE.Group();
  const L = 0.9, W = 0.3, ride = 0.035, H = 0.34, half = L / 2;
  // Low floor body, a continuous glass band and a white roof cap with an AC pod.
  rbox(g, L, H * 0.42, W, 0.05, paint(), 'body', 0, ride + H * 0.21, 0, 4);
  rbox(g, L * 0.97, H * 0.4, W * 0.97, 0.04, glassMat(), 'detail', 0, ride + H * 0.62, 0, 3);
  rbox(g, L, H * 0.16, W, 0.05, paint(), 'body', 0, ride + H * 0.9, 0, 4);
  rbox(g, L * 0.3, 0.035, W * 0.6, 0.015, trim(0xe9ecee, 0.5), 'detail', -L * 0.12, ride + H + 0.012, 0, 2);
  // Window mullions (in body paint) along both sides.
  for (let i = -3; i <= 3; i += 1) for (const side of [-1, 1]) add(g, new THREE.BoxGeometry(0.014, H * 0.38, 0.006), paint(), 'body', i * L * 0.13, ride + H * 0.62, side * (W * 0.485 + 0.002));
  // Doors (darker glass) on the kerb side (+Z, the right of the direction of travel).
  for (const x of [L * 0.33, -L * 0.05]) add(g, new THREE.BoxGeometry(0.1, H * 0.78, 0.008), trim(0x253038, 0.2), 'detail', x, ride + H * 0.42, W / 2 + 0.002);
  // Destination display and lamps.
  add(g, new THREE.BoxGeometry(0.008, 0.035, W * 0.6), lamp(0xffb347), 'light', half + 0.001, ride + H * 0.86, 0);
  for (const side of [-1, 1]) {
    add(g, new THREE.BoxGeometry(0.012, 0.03, W * 0.16), lamp(0xfff3d6), 'light', half - 0.002, ride + H * 0.16, side * W * 0.34);
    add(g, new THREE.BoxGeometry(0.012, 0.06, W * 0.1), lamp(0xe2453c), 'light', -half + 0.002, ride + H * 0.3, side * W * 0.4);
  }
  rbox(g, 0.03, 0.05, W * 0.98, 0.012, trim(0x3a4044), 'detail', half - 0.012, ride + 0.03, 0, 2);
  rbox(g, 0.03, 0.05, W * 0.98, 0.012, trim(0x3a4044), 'detail', -half + 0.012, ride + 0.03, 0, 2);
  for (const x of [L * 0.32, -L * 0.3]) for (const side of [-1, 1]) wheel(g, x, side * (W / 2 - 0.03), 0.06, 0.05);
  return g;
}

export const VEHICLE_MODELS = {
  compact: () => car({ L: 0.46, W: 0.25, ride: 0.035, shell: 0.11, cabinFront: 0.12, cabinRear: -0.17, cabinH: 0.1, wheelR: 0.05 }),
  sedan: () => car({ L: 0.54, W: 0.26, ride: 0.032, shell: 0.1, cabinFront: 0.09, cabinRear: -0.13, cabinH: 0.095, wheelR: 0.05 }),
  suv: () => car({ L: 0.56, W: 0.28, ride: 0.05, shell: 0.13, cabinFront: 0.1, cabinRear: -0.22, cabinH: 0.11, wheelR: 0.062, roof: 0.96 }),
  van,
  bus,
};

/**
 * Bus-stop shelter on the north curb of a road tile (rotated for the other curbs): two posts, a glass back panel,
 * a flat canopy, a bench and a round stop sign on a pole. Built around the tile centre (0, 0, 0); all 'detail'.
 */
export function busStop() {
  const g = new THREE.Group();
  const z0 = -0.5, depth = 0.13;
  const frame = trim(0x40494e, 0.45), canopy = material('canopy', () => new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.5 }));
  const panel = material('panel', () => new THREE.MeshPhysicalMaterial({ color: 0xbfd9df, roughness: 0.08, metalness: 0.1, transmission: 0, transparent: true, opacity: 0.55, clearcoat: 1 }));
  for (const x of [-0.24, 0.24]) add(g, new THREE.BoxGeometry(0.022, 0.42, 0.022), frame, 'detail', x, 0.21, z0 + 0.03);
  add(g, new THREE.BoxGeometry(0.5, 0.3, 0.008), panel, 'detail', 0, 0.2, z0 + 0.025);
  rbox(g, 0.58, 0.026, depth + 0.04, 0.008, canopy, 'detail', 0, 0.43, z0 + depth / 2, 2);
  rbox(g, 0.36, 0.022, 0.06, 0.008, material('bench', () => new THREE.MeshStandardMaterial({ color: 0xb98a5e, roughness: 0.7 })), 'detail', -0.02, 0.11, z0 + 0.07, 2);
  add(g, new THREE.BoxGeometry(0.014, 0.11, 0.014), frame, 'detail', -0.17, 0.055, z0 + 0.07);
  add(g, new THREE.BoxGeometry(0.014, 0.11, 0.014), frame, 'detail', 0.13, 0.055, z0 + 0.07);
  // Sign pole at the road end of the shelter.
  add(g, new THREE.CylinderGeometry(0.009, 0.009, 0.52, 10), frame, 'detail', 0.34, 0.26, z0 + 0.08);
  const sign = new THREE.CylinderGeometry(0.06, 0.06, 0.012, 24);
  sign.rotateZ(Math.PI / 2);
  add(g, sign, material('sign', () => new THREE.MeshStandardMaterial({ color: 0x2f8f83, roughness: 0.4 })), 'detail', 0.34, 0.5, z0 + 0.08);
  add(g, new THREE.BoxGeometry(0.014, 0.05, 0.05), material('signFace', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0x222222 })), 'light', 0.348, 0.5, z0 + 0.08);
  return g;
}
