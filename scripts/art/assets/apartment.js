// Apartment building (4×4): a five-storey residential block with stepped massing, deep balconies, coloured fins,
// a glazed lobby and corner café, a roof garden and a landscaped forecourt. Built facing south (+Z); mirrored
// for east-facing lots. Roof stays under the clickable height (buildingLift 87 + cap 4 px ≈ 2.65 units).
import * as THREE from 'three';
import { PALETTE as P, mat, box, plate, windowOn, shopfrontOn, doorOn, awningOn, balconyOn, bandOn, planter, path, shrub, broadleaf, palm, bench, flowerbed, hedge, rng, glass, umbrella } from '../lib/kit.js';

export const APARTMENT_VARIANTS = [
  { wall: P.ivory, fin: P.terracotta, base: 0xcfc4b0, balcony: 'glass', awning: [P.terracotta, P.ivory], tree: 'palm' },
  { wall: 0xeef1ea, fin: P.teal, base: 0xd2c7b2, balcony: 'bars', awning: [P.teal, P.ivory], tree: 'round' },
  { wall: 0xf6e9d6, fin: 0x6f8f6a, base: 0xc9bca4, balcony: 'glass', awning: [P.gold, P.ivory], tree: 'blossom' },
];

const STOREY = 0.44, GROUND = 0.5;

export function buildApartment(group, variantIndex, seed) {
  const v = APARTMENT_VARIANTS[variantIndex % APARTMENT_VARIANTS.length];
  const random = rng(seed);
  plate(group, 4, 4, 0x86ad70);
  // Forecourt plaza along the street and a garden strip on the east side.
  path(group, 0.1, 3.42, 3.8, 0.56, P.paving);
  for (let i = 1; i < 16; i += 1) box(group, 0.1 + i * 0.2375, 0.012, 3.42, 0.006, 0.002, 0.56, mat(0xd4c9b4));
  path(group, 3.55, 0.35, 0.4, 3.05, 0xdcd2bd);

  // Main block.
  const x0 = 0.32, x1 = 3.5, z0 = 0.4, z1 = 3.3;
  const upper = 4;
  const top = GROUND + upper * STOREY;
  box(group, x0 - 0.03, 0, z0 - 0.03, x1 - x0 + 0.06, 0.06, z1 - z0 + 0.06, mat(v.base, { rough: 0.9 }));
  // Stone-clad ground floor.
  box(group, x0, 0.05, z0, x1 - x0, GROUND - 0.05, z1 - z0, mat(v.base, { rough: 0.85 }));
  // Upper floors: the front-right corner steps back one bay above the third storey for a terrace.
  box(group, x0, GROUND, z0, x1 - x0, upper * STOREY, z1 - z0 - 0.02, mat(v.wall, { rough: 0.88 }));
  bandOn(group, 'south', z1 - 0.02, x0, x1 - x0, GROUND - 0.04, { color: P.ivory, h: 0.05, out: 0.04 });
  bandOn(group, 'east', x1, z0, z1 - z0, GROUND - 0.04, { color: P.ivory, h: 0.05, out: 0.04 });

  // Ground floor: lobby in the middle, café on the corner, windows on the side.
  const fz = z1 - 0.02;
  shopfrontOn(group, 'south', fz, 1.45, 0.62, GROUND * 0.82, { frame: P.charcoal, tint: 0xbfdde2 });
  doorOn(group, 'south', fz, 1.62, 0.26, GROUND * 0.7, { color: 0x45545a, frame: P.charcoal, glazed: true });
  box(group, 1.36, GROUND * 0.86, fz, 0.8, 0.04, 0.3, mat(P.charcoal, { rough: 0.5 }));
  box(group, 1.4, GROUND * 0.9, fz + 0.29, 0.72, 0.04, 0.015, mat(P.gold, { rough: 0.35, metal: 0.4 }));
  shopfrontOn(group, 'south', fz, 2.45, 0.95, GROUND * 0.78, { frame: v.fin, lit: true });
  awningOn(group, 'south', fz, 2.4, 1.05, GROUND * 0.9, { colors: v.awning, depth: 0.26, drop: 0.12, stripes: 10 });
  shopfrontOn(group, 'east', x1, 2.5, 0.68, GROUND * 0.78, { frame: v.fin, lit: true });
  for (const u of [0.5, 0.9]) windowOn(group, 'south', fz, u, 0.14, 0.24, 0.26, { frame: P.ivory });
  for (const u of [0.7, 1.15, 1.6]) windowOn(group, 'east', x1, u, 0.14, 0.24, 0.26, { frame: P.ivory });

  // Upper storeys: window bays with balconies; coloured vertical fins frame the bays.
  const bays = 6;
  for (let s = 0; s < upper; s += 1) {
    const v0 = GROUND + s * STOREY;
    for (let b = 0; b < bays; b += 1) {
      const u = x0 + 0.08 + b * ((x1 - x0 - 0.16) / bays);
      const w = (x1 - x0 - 0.16) / bays;
      const balcony = (b + s) % 2 === 0;
      windowOn(group, 'south', fz, u + w * 0.15, v0 + 0.09, w * 0.7, STOREY * (balcony ? 0.68 : 0.56), { frame: P.ivory, sill: !balcony, mullion: true });
      if (balcony) balconyOn(group, 'south', fz, u + w * 0.04, w * 0.92, v0 + 0.02, { depth: 0.16, railing: v.balcony, color: P.ivory });
    }
    for (let b = 0; b < 5; b += 1) {
      const u = z0 + 0.12 + b * ((z1 - z0 - 0.24) / 5);
      const w = (z1 - z0 - 0.24) / 5;
      const balcony = (b + s) % 2 === 1;
      windowOn(group, 'east', x1, u + w * 0.15, v0 + 0.09, w * 0.7, STOREY * (balcony ? 0.68 : 0.56), { frame: P.ivory, sill: !balcony });
      if (balcony) balconyOn(group, 'east', x1, u + w * 0.04, w * 0.92, v0 + 0.02, { depth: 0.14, railing: v.balcony, color: P.ivory });
    }
    bandOn(group, 'south', fz, x0, x1 - x0, v0 + STOREY - 0.02, { color: P.ivory, h: 0.022, out: 0.012 });
    bandOn(group, 'east', x1, z0, z1 - z0, v0 + STOREY - 0.02, { color: P.ivory, h: 0.022, out: 0.012 });
  }
  // Coloured fins at the corners and between bay groups.
  const finMat = mat(v.fin, { rough: 0.75 });
  for (const u of [x0, x0 + (x1 - x0) / 2 - 0.04, x1 - 0.08]) box(group, u, GROUND, fz - 0.02, 0.08, upper * STOREY + 0.06, 0.07, finMat);
  for (const u of [z0 + (z1 - z0) / 2 - 0.04]) box(group, x1 - 0.02, GROUND, u, 0.07, upper * STOREY + 0.06, 0.08, finMat);

  // Roof: parapet, roof garden, pergola, plant room and solar panels.
  box(group, x0 - 0.02, top, z0 - 0.02, x1 - x0 + 0.04, 0.07, z1 - z0 + 0.04, mat(P.ivory));
  box(group, x0 + 0.05, top, z0 + 0.05, x1 - x0 - 0.1, 0.05, z1 - z0 - 0.1, mat(0xbdb6a6, { rough: 0.95 }));
  const roofTop = new THREE.Group(); roofTop.position.y = top + 0.05; group.add(roofTop);
  box(roofTop, 0.5, 0, 0.6, 0.7, 0.16, 0.5, mat(0xe2ddd2));
  box(roofTop, 0.55, 0.16, 0.65, 0.12, 0.05, 0.12, mat(P.slate, { metal: 0.3, rough: 0.5 }));
  for (let i = 0; i < 3; i += 1) {
    const panel = box(roofTop, 1.5 + i * 0.36, 0.04, 0.6, 0.3, 0.02, 0.5, mat(0x2f4a66, { rough: 0.25, metal: 0.4 }));
    panel.rotation.x = -0.3;
  }
  // Pergola terrace with planters at the front of the roof.
  const px0 = 1.9, pz0 = 2.2, pw = 1.4, pd = 0.9;
  box(roofTop, px0, 0, pz0, pw, 0.008, pd, mat(P.timber, { rough: 0.8 }));
  for (const [ax, az] of [[px0, pz0], [px0 + pw - 0.03, pz0], [px0, pz0 + pd - 0.03], [px0 + pw - 0.03, pz0 + pd - 0.03]]) box(roofTop, ax, 0, az, 0.03, 0.2, 0.03, mat(P.walnut));
  for (let i = 0; i < 7; i += 1) box(roofTop, px0 + i * (pw / 6) - 0.01, 0.2, pz0, 0.02, 0.02, pd, mat(P.timber));
  planter(roofTop, 0.5, 2.9, 1.2, 0.14, random, { h: 0.08 });
  planter(roofTop, 0.45, 1.3, 0.14, 1.4, random, { h: 0.08 });
  umbrella(roofTop, px0 + 0.4, pz0 + 0.45, v.awning[0]);
  shrub(roofTop, 1.2, 2.1, random, { scale: 1.1 });

  // Forecourt: planters, benches, bikes, street trees and a lamp.
  for (const u of [0.25, 0.95]) planter(group, u, 3.5, 0.5, 0.16, random, { box: P.stone, h: 0.08 });
  bench(group, 0.75, 3.85, 'x');
  for (let i = 0; i < 3; i += 1) {
    const bike = box(group, 3.0 + i * 0.1, 0.03, 3.62, 0.012, 0.06, 0.16, mat([P.coral, P.teal, P.gold][i], { rough: 0.5 }));
    bike.rotation.y = 0.1;
  }
  // Café tables under the awning.
  for (const u of [2.6, 3.05]) { umbrella(group, u, 3.7, v.awning[0]); }
  // East garden.
  hedge(group, 3.92, 0.1, 3.2, 'z', { h: 0.1, w: 0.07 });
  flowerbed(group, 3.6, 0.45, 0.3, 0.7, random);
  if (v.tree === 'palm') { palm(group, 3.72, 1.6, random, { scale: 1.25 }); palm(group, 3.75, 2.4, random, { scale: 1.1 }); }
  else { broadleaf(group, 3.74, 1.7, random, { scale: 1.1, leaves: v.tree }); broadleaf(group, 3.74, 2.6, random, { scale: 0.95, leaves: 'deep' }); }
  broadleaf(group, 0.18, 3.8, random, { scale: 0.9, leaves: 'round' });
  broadleaf(group, 3.78, 3.82, random, { scale: 0.85, leaves: v.tree === 'blossom' ? 'blossom' : 'olive' });
  shrub(group, 3.62, 3.25, random, { scale: 1, flowers: P.gold });
  return group;
}

export function apartmentAssets() {
  return APARTMENT_VARIANTS.flatMap((_, index) => ['S', 'E'].map((front) => ({
    id: `apartment.v${index}.${front}`, kind: 'apartment', variant: index, front, footprint: { w: 4, d: 4 },
    build: (g) => buildApartment(g, index, 3000 + index * 41),
  })));
}
