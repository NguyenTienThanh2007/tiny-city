// Park (4×4): a landscaped neighbourhood park — curving paths, lawn, mixed trees, flowerbeds, benches, lamps and
// a centrepiece (fountain, pond with a bridge, or pavilion). Flat lot; trees rise above the clickable cap.
import * as THREE from 'three';
import { PALETTE as P, mat, box, plate, cylinder, sphere, path, flowerbed, shrub, broadleaf, palm, cypress, bench, streetLamp, hedge, rng } from '../lib/kit.js';

export const PARK_VARIANTS = ['fountain', 'pond', 'pavilion'];

/** Curved path as a chain of short paved slabs following a quadratic curve. */
function curve(group, a, c, b, width, color = P.paving) {
  const steps = 26;
  const m = mat(color, { rough: 0.95 });
  for (let i = 0; i < steps; i += 1) {
    const t = (i + 0.5) / steps;
    const x = (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0];
    const z = (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1];
    const dx = 2 * (1 - t) * (c[0] - a[0]) + 2 * t * (b[0] - c[0]);
    const dz = 2 * (1 - t) * (c[1] - a[1]) + 2 * t * (b[1] - c[1]);
    const len = Math.hypot(dx, dz) / steps * 1.25;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(len, 0.014, width), m);
    slab.position.set(x, 0.007, z);
    slab.rotation.y = -Math.atan2(dz, dx);
    slab.receiveShadow = true;
    group.add(slab);
    // Edging stones.
    const edge = new THREE.Mesh(new THREE.BoxGeometry(len, 0.02, width + 0.04), mat(0xc7bba4, { rough: 0.9 }));
    edge.position.set(x, 0.004, z); edge.rotation.y = slab.rotation.y; edge.receiveShadow = true;
    group.add(edge);
  }
}

function fountain(group, x, z) {
  cylinder(group, x, 0, z, 0.42, 0.44, 0.06, mat(P.stone, { rough: 0.7 }), 32);
  const water = new THREE.MeshPhysicalMaterial({ color: 0x4fbac6, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.6 });
  cylinder(group, x, 0.02, z, 0.38, 0.38, 0.05, water, 32);
  cylinder(group, x, 0, z, 0.08, 0.1, 0.22, mat(P.ivory, { rough: 0.6 }), 16);
  cylinder(group, x, 0.22, z, 0.18, 0.12, 0.04, mat(P.ivory, { rough: 0.6 }), 24);
  cylinder(group, x, 0.24, z, 0.15, 0.15, 0.025, water, 24);
  cylinder(group, x, 0.26, z, 0.03, 0.04, 0.1, mat(P.ivory), 12);
  const spray = new THREE.MeshPhysicalMaterial({ color: 0xe6f7f7, roughness: 0.1, transparent: true, opacity: 0.75 });
  sphere(group, x, 0.38, z, 0.045, spray, 2);
  for (let i = 0; i < 8; i += 1) { const a = (i / 8) * Math.PI * 2; sphere(group, x + Math.cos(a) * 0.13, 0.27, z + Math.sin(a) * 0.13, 0.02, spray, 1); }
}

function pond(group, x, z, random) {
  const outline = (k) => {
    const shape = new THREE.Shape();
    for (let i = 0; i <= 40; i += 1) {
      const a = (i / 40) * Math.PI * 2, r = (0.62 + Math.sin(a * 3 + 1) * 0.08 + Math.cos(a * 2) * 0.06) * k;
      const px = Math.cos(a) * r * 1.25, pz = Math.sin(a) * r * 0.85;
      if (i === 0) shape.moveTo(px, pz); else shape.lineTo(px, pz);
    }
    return shape;
  };
  const shape = outline(1);
  const ring = outline(1.12);
  ring.holes.push(new THREE.Path(shape.getPoints()));
  const rim = new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: 0.03, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.01, bevelSegments: 2 }), mat(0xc9bfa8, { rough: 0.9 }));
  rim.rotation.x = Math.PI / 2; rim.position.set(x, 0.03, z); rim.receiveShadow = true; group.add(rim);
  const water = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshPhysicalMaterial({ color: 0x3fa9b8, roughness: 0.04, clearcoat: 1, envMapIntensity: 1.5, side: THREE.DoubleSide }));
  // Same orientation as the rim (shape y → +z), seen from above thanks to DoubleSide.
  water.rotation.x = Math.PI / 2; water.position.set(x, 0.02, z); water.receiveShadow = true; group.add(water);
  for (let i = 0; i < 5; i += 1) { // lily pads
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.045, 12), mat(0x6fa95e));
    pad.rotation.x = -Math.PI / 2; pad.position.set(x - 0.4 + random() * 0.8, 0.037, z - 0.2 + random() * 0.4); group.add(pad);
    if (i % 2 === 0) sphere(group, pad.position.x, 0.045, pad.position.z, 0.012, mat(0xf4a6b8), 0);
  }
  // Timber footbridge.
  const bridge = new THREE.Group();
  box(bridge, -0.12, 0.05, -0.5, 0.24, 0.025, 1.0, mat(P.timber, { rough: 0.8 }));
  for (const side of [-0.12, 0.1]) { box(bridge, side, 0.075, -0.5, 0.02, 0.08, 1.0, mat(P.walnut)); }
  bridge.position.set(x + 0.15, 0, z); bridge.rotation.y = 0.35; group.add(bridge);
  for (let i = 0; i < 6; i += 1) { const a = random() * Math.PI * 2; sphere(group, x + Math.cos(a) * 0.78, 0.03, z + Math.sin(a) * 0.55, 0.04 + random() * 0.03, mat(0xbab3a3, { rough: 0.9 }), 1); }
}

function pavilion(group, x, z) {
  cylinder(group, x, 0, z, 0.5, 0.52, 0.05, mat(P.stone), 8);
  for (let i = 0; i < 8; i += 1) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; cylinder(group, x + Math.cos(a) * 0.42, 0.05, z + Math.sin(a) * 0.42, 0.025, 0.025, 0.36, mat(P.ivory), 10); }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.26, 8), mat(P.roofTeal, { rough: 0.7, flat: true }));
  roof.position.set(x, 0.54, z); roof.rotation.y = Math.PI / 8; roof.castShadow = true; roof.receiveShadow = true; group.add(roof);
  cylinder(group, x, 0.41, z, 0.6, 0.6, 0.03, mat(P.ivory), 8).rotation.y = Math.PI / 8;
  sphere(group, x, 0.69, z, 0.03, mat(P.gold, { metal: 0.6, rough: 0.3 }), 1);
}

export function buildPark(group, variantIndex, seed) {
  const feature = PARK_VARIANTS[variantIndex % PARK_VARIANTS.length];
  const random = rng(seed);
  plate(group, 4, 4, 0x80ab69);
  // Mown stripes for a cared-for lawn.
  for (let i = 0; i < 8; i += 1) box(group, 0, 0.0, i * 0.5, 4, 0.004, 0.25, mat(0x86b06f, { rough: 1 }));
  // Paths: a loop around the centrepiece and entries from each side.
  const c = [2, 2];
  curve(group, [0, 2.15], [1.0, 1.4], c, 0.22);
  curve(group, c, [3.0, 2.6], [4, 2.2], 0.22);
  curve(group, [2.1, 4], [2.6, 3.0], c, 0.18);
  curve(group, [1.9, 0], [1.4, 1.0], c, 0.18);
  // Centrepiece plaza.
  cylinder(group, c[0], 0, c[1], 0.66, 0.68, 0.016, mat(P.paving, { rough: 0.95 }), 40);
  cylinder(group, c[0], 0, c[1], 0.7, 0.72, 0.01, mat(0xc7bba4, { rough: 0.95 }), 40);
  if (feature === 'fountain') fountain(group, c[0], c[1]);
  else if (feature === 'pond') pond(group, c[0], c[1], random);
  else pavilion(group, c[0], c[1]);
  // Benches facing the plaza and lamps along the paths.
  bench(group, 1.2, 2.55, 'x'); bench(group, 2.75, 1.35, 'x'); bench(group, 2.6, 2.75, 'z');
  streetLamp(group, 1.05, 1.85, { height: 0.5 }); streetLamp(group, 3.0, 2.25, { height: 0.5 }); streetLamp(group, 2.35, 3.3, { height: 0.5 });
  // Flowerbeds.
  flowerbed(group, 0.3, 2.6, 0.6, 0.32, random);
  flowerbed(group, 3.0, 3.2, 0.62, 0.3, random, [P.coral, P.gold, P.ivory]);
  flowerbed(group, 2.5, 0.35, 0.5, 0.3, random, [0xb9a3e3, 0xf4a6b8, P.ivory]);
  // Trees: a mixed grove at the back, feature trees at the front corners.
  const grove = [[0.45, 0.5, 'round', 1.15], [1.15, 0.35, 'deep', 1.0], [0.35, 1.25, 'olive', 0.95], [3.45, 0.55, 'round', 1.1], [3.6, 1.35, 'deep', 0.95]];
  for (const [x, z, leaves, scale] of grove) broadleaf(group, x, z, random, { scale, leaves });
  broadleaf(group, 0.5, 3.45, random, { scale: 1.0, leaves: 'blossom' });
  palm(group, 3.55, 3.5, random, { scale: 1.1 });
  cypress(group, 1.55, 3.6, random, { scale: 0.9 }); cypress(group, 1.3, 3.75, random, { scale: 0.8 });
  for (const [x, z] of [[0.95, 1.05], [3.1, 1.75], [1.6, 2.9], [3.7, 2.8], [0.2, 3.0]]) shrub(group, x, z, random, { scale: 1.15, flowers: random() < 0.5 ? P.coral : null });
  hedge(group, 0.05, 0.05, 1.6, 'x', { h: 0.08, w: 0.07 });
  hedge(group, 2.4, 0.05, 1.55, 'x', { h: 0.08, w: 0.07 });
  return group;
}

export function parkAssets() {
  return PARK_VARIANTS.map((_, index) => ({ id: `park.v${index}.S`, kind: 'park', variant: index, front: 'S', footprint: { w: 4, d: 4 },
    build: (g) => buildPark(g, index, 4000 + index * 53) }));
}
