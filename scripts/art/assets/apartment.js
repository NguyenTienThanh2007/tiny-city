// Apartment building (4×4), Visual World 3.0B: a six-storey residential block with a stone base, a projecting
// coloured bay, deep balconies with planters, a setback penthouse with a roof terrace, a lit entrance with
// canopy and sign, a corner café, rooftop structures and a landscaped courtyard. Built facing south; mirrored
// for east-facing lots.
import * as THREE from 'three';
import { PALETTE as P, mat, box, cylinder, plate, windowOn, shopfrontOn, doorOn, awningOn, balconyOn, bandOn, planter, path, shrub, broadleaf, palm, bench, flowerbed, hedge, rng, umbrella, flatRoof, wallMat, renderMat, stoneMat, woodMat, pavingMat, concreteMat } from '../lib/kit.js';
import { windowBox, wallLamp, signOn, pottedPlant, bikeRack, bin, acUnit, pergola, picnicTable, playground } from '../lib/props.js';

export const APARTMENT_VARIANTS = [
  { wall: 0xf7efe2, bay: 0xd9805f, base: 0xcfc2aa, rail: 'glass', awning: [P.terracotta, P.ivory], tree: 'palm', name: 'SEABREEZE' },
  { wall: 0xeef2ec, bay: 0x4f8f8b, base: 0xd2c7b2, rail: 'bars', awning: [P.teal, P.ivory], tree: 'round', name: 'MARINA' },
  { wall: 0xf6e7cf, bay: 0x6f8f6a, base: 0xc9bca4, rail: 'glass', awning: [P.gold, P.ivory], tree: 'jacaranda', name: 'CORAL' },
];
const STOREY = 0.42, GROUND = 0.52, FLOORS = 5;

function storeyRow(group, random, v, side, plane, from, length, s, bays, balconyPattern) {
  const v0 = GROUND + s * STOREY;
  const w = length / bays;
  for (let b = 0; b < bays; b += 1) {
    const u = from + b * w;
    const balcony = balconyPattern(b, s);
    windowOn(group, side, plane, u + w * 0.14, v0 + 0.08, w * 0.72, STOREY * (balcony ? 0.7 : 0.56), { frame: P.white, sill: !balcony, mullion: true });
    if (balcony) {
      balconyOn(group, side, plane, u + w * 0.04, w * 0.92, v0 + 0.02, { depth: 0.17, railing: v.rail, color: P.ivory });
      if ((b + s) % 3 === 0) windowBox(group, side, plane + 0.15, u + w * 0.1, w * 0.3, v0 + 0.2, random);
    } else if ((b + s) % 2 === 0) windowBox(group, side, plane, u + w * 0.14, w * 0.72, v0 + 0.08, random);
  }
  bandOn(group, side, plane, from - 0.02, length + 0.04, v0 + STOREY - 0.02, { color: P.white, h: 0.022, out: 0.014 });
}

export function buildApartment(group, variantIndex, seed) {
  const v = APARTMENT_VARIANTS[variantIndex % APARTMENT_VARIANTS.length];
  const random = rng(seed);
  plate(group, 4, 4, 0x86ad70);
  // Forecourt plaza and a planted courtyard strip on the east side.
  box(group, 0.08, 0, 3.36, 3.84, 0.014, 0.6, pavingMat(0xe7decb));
  path(group, 3.58, 0.3, 0.36, 3.04, 0xdcd2bd);

  const x0 = 0.3, x1 = 3.48, z0 = 0.38, z1 = 3.28;
  const top = GROUND + FLOORS * STOREY;
  box(group, x0 - 0.03, 0, z0 - 0.03, x1 - x0 + 0.06, 0.07, z1 - z0 + 0.06, stoneMat(v.base));
  box(group, x0, 0.06, z0, x1 - x0, GROUND - 0.06, z1 - z0, stoneMat(v.base));
  box(group, x0, GROUND, z0, x1 - x0, FLOORS * STOREY, z1 - z0, renderMat(v.wall));
  bandOn(group, 'south', z1, x0, x1 - x0, GROUND - 0.05, { color: P.ivory, h: 0.06, out: 0.045 });
  bandOn(group, 'east', x1, z0, z1 - z0, GROUND - 0.05, { color: P.ivory, h: 0.06, out: 0.045 });

  // Projecting coloured bay on the front (two window columns, full height).
  const bx0 = 1.1, bx1 = 1.9, bz1 = z1 + 0.12;
  box(group, bx0, GROUND, z1 - 0.1, bx1 - bx0, FLOORS * STOREY + 0.06, bz1 - z1 + 0.1, renderMat(v.bay));
  for (let s = 0; s < FLOORS; s += 1) {
    const v0 = GROUND + s * STOREY;
    for (const u of [bx0 + 0.07, bx0 + 0.42]) windowOn(group, 'south', bz1, u, v0 + 0.08, 0.3, STOREY * 0.62, { frame: P.white, mullion: true, sill: false });
    bandOn(group, 'south', bz1, bx0, bx1 - bx0, v0 + STOREY - 0.02, { color: P.white, h: 0.02, out: 0.012 });
  }
  // Main front: window bays with alternating balconies either side of the bay.
  for (let s = 0; s < FLOORS; s += 1) {
    storeyRow(group, random, v, 'south', z1, x0 + 0.04, bx0 - x0 - 0.08, s, 2, (b, st) => (b + st) % 2 === 0);
    storeyRow(group, random, v, 'south', z1, bx1 + 0.04, x1 - bx1 - 0.08, s, 4, (b, st) => (b + st) % 2 === 1);
    storeyRow(group, random, v, 'east', x1, z0 + 0.06, z1 - z0 - 0.12, s, 6, (b, st) => b % 2 === st % 2);
  }
  // Ground floor: lobby under a canopy with a lit name sign, café on the corner, side shopfronts.
  shopfrontOn(group, 'south', bz1, bx0 + 0.06, bx1 - bx0 - 0.12, GROUND * 0.82, { frame: P.charcoal, tint: 0xbfdde2 });
  doorOn(group, 'south', bz1, bx0 + 0.28, 0.24, GROUND * 0.72, { color: 0x45545a, frame: P.charcoal, glazed: true });
  box(group, bx0 - 0.06, GROUND * 0.88, bz1, bx1 - bx0 + 0.12, 0.035, 0.34, mat(P.charcoal, { rough: 0.45, metal: 0.3 }));
  for (const cx of [bx0 - 0.02, bx1 - 0.02]) box(group, cx, 0, bz1 + 0.3, 0.025, GROUND * 0.88, 0.025, mat(P.charcoal, { metal: 0.4 }));
  signOn(group, 'south', bz1 + 0.34, bx0 + 0.04, GROUND * 0.9, bx1 - bx0 - 0.08, 0.09, v.name, { bg: '#26333a', fg: '#f6d27a', font: '700 64px Georgia, serif' });
  wallLamp(group, 'south', bz1, bx0 + 0.05, GROUND * 0.6); wallLamp(group, 'south', bz1, bx1 - 0.09, GROUND * 0.6);
  shopfrontOn(group, 'south', z1, 2.4, 1.0, GROUND * 0.78, { frame: v.bay, lit: true });
  awningOn(group, 'south', z1, 2.36, 1.08, GROUND * 0.9, { colors: v.awning, depth: 0.28, drop: 0.12, stripes: 10 });
  signOn(group, 'south', z1, 2.6, GROUND * 0.93, 0.6, 0.075, 'CAFÉ', { bg: '#34433f', fg: '#f6d27a' });
  shopfrontOn(group, 'east', x1, 2.45, 0.7, GROUND * 0.78, { frame: v.bay, lit: true });
  for (const u of [0.45, 0.82]) windowOn(group, 'south', z1, u, 0.14, 0.24, 0.27, { frame: P.ivory });
  for (const u of [0.65, 1.1, 1.55, 2.0]) windowOn(group, 'east', x1, u, 0.14, 0.24, 0.27, { frame: P.ivory });
  for (const u of [0.55, 1.4]) acUnit(group, 'east', x1, u + 0.1, GROUND + 2 * STOREY + 0.05);

  // Roof: parapet, setback penthouse with terrace and pergola, stair core, water tank, solar.
  flatRoof(group, x0, z0, x1, z1, top, { h: 0.09, color: P.ivory, deck: 0xbab6ad });
  const roofTop = new THREE.Group(); roofTop.position.y = top + 0.02; group.add(roofTop);
  // Penthouse: a lighter glazed volume set back from the street.
  box(roofTop, 0.5, 0, 0.55, 1.9, 0.38, 1.25, renderMat(0xfbf7ef));
  flatRoof(roofTop, 0.5, 0.55, 2.4, 1.8, 0.38, { h: 0.05, color: P.white, deck: 0xc4c0b8 });
  for (let i = 0; i < 4; i += 1) { const panel = box(roofTop, 0.62 + i * 0.42, 0.44, 0.75, 0.36, 0.02, 0.4, mat(0x2f4a66, { rough: 0.25, metal: 0.4 })); panel.rotation.x = -0.3; }
  const penthouseRoof = new THREE.Group(); penthouseRoof.position.y = 0.4; roofTop.add(penthouseRoof);
  planter(penthouseRoof, 0.6, 1.5, 1.6, 0.12, random, { h: 0.06 });
  for (let i = 0; i < 5; i += 1) windowOn(roofTop, 'south', 1.8, 0.58 + i * 0.36, 0.04, 0.28, 0.28, { frame: P.charcoal, sill: false });
  windowOn(roofTop, 'east', 2.4, 0.75, 0.05, 0.3, 0.26, { frame: P.charcoal, sill: false }); windowOn(roofTop, 'east', 2.4, 1.2, 0.05, 0.3, 0.26, { frame: P.charcoal, sill: false });
  box(roofTop, 0.4, 0, 1.85, 2.2, 0.01, 1.2, woodMat());
  pergola(roofTop, 1.55, 2.05, 0.8, 0.6, 0.28, P.timber, random);
  umbrella(roofTop, 0.8, 2.4, v.awning[0]); umbrella(roofTop, 1.2, 2.7, v.awning[0]);
  planter(roofTop, 0.45, 2.92, 2.1, 0.12, random, { h: 0.08 });
  box(roofTop, 2.7, 0, 0.6, 0.45, 0.44, 0.4, renderMat(0xeae4d8));
  cylinder(roofTop, 3.1, 0, 1.4, 0.13, 0.13, 0.3, mat(0xb9a58a, { rough: 0.6 }), 16);
  cylinder(roofTop, 3.1, 0.3, 1.4, 0.15, 0.13, 0.04, mat(0x9a8a72), 16);
  for (let i = 0; i < 3; i += 1) { const panel = box(roofTop, 2.6 + (i % 2) * 0.38, 0.05, 2.0 + Math.floor(i / 2) * 0.55, 0.32, 0.02, 0.45, mat(0x2f4a66, { rough: 0.25, metal: 0.4 })); panel.rotation.x = -0.3; }

  // Forecourt and courtyard: planters, benches, bikes, café tables, trees, a small playground.
  for (const u of [0.18, 0.62]) planter(group, u, 3.42, 0.36, 0.16, random, { box: P.stone, h: 0.09 });
  bench(group, 0.95, 3.82, 'x'); bin(group, 1.2, 3.82);
  bikeRack(group, 3.05, 3.86, 4, random);
  for (const u of [2.55, 2.95]) umbrella(group, u, 3.66, v.awning[0]);
  pottedPlant(group, bx0 - 0.1, bz1 + 0.1, random, 1.2); pottedPlant(group, bx1 + 0.1, bz1 + 0.1, random, 1.2);
  hedge(group, 3.92, 0.1, 3.2, 'z', { h: 0.12, w: 0.07 });
  flowerbed(group, 3.6, 0.4, 0.3, 0.5, random);
  playground(group, 3.58, 1.0, random);
  picnicTable(group, 3.75, 2.0);
  if (v.tree === 'palm') { palm(group, 3.72, 2.5, random, { scale: 1.45 }); palm(group, 3.78, 3.0, random, { scale: 1.25 }); }
  else { broadleaf(group, 3.74, 2.55, random, { scale: 1.25, leaves: v.tree }); broadleaf(group, 3.76, 3.1, random, { scale: 1.05, leaves: 'deep' }); }
  broadleaf(group, 0.16, 3.78, random, { scale: 1.1, leaves: 'round' });
  broadleaf(group, 0.16, 0.25, random, { scale: 1.2, leaves: 'deep' });
  shrub(group, 3.62, 3.3, random, { scale: 1.2, flowers: P.gold });
  return group;
}

export function apartmentAssets() {
  return APARTMENT_VARIANTS.flatMap((_, index) => ['S', 'E'].map((front) => ({
    id: `apartment.v${index}.${front}`, kind: 'apartment', variant: index, front, footprint: { w: 4, d: 4 },
    build: (g) => buildApartment(g, index, 3000 + index * 41),
  })));
}
