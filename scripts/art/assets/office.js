// Office tower (4×4), Visual World 3.0B: a premium glass tower on a stone podium. Curtain-wall floors of
// individually lit glass bays between slim mullions and accent fins, a setback crown with a lit company panel,
// rooftop plant, a mast and a garden terrace, a double-height glazed lobby with a canopy, and a landscaped
// plaza with trees in planters, benches, a sculpture and bikes. Built facing south; mirrored for east lots.
import * as THREE from 'three';
import { PALETTE as P, mat, box, cylinder, plate, bandOn, broadleaf, palm, shrub, bench, flowerbed, hedge, planter, rng, flatRoof, stoneMat, pavingMat, concreteMat, renderMat, glass, poplar, sphere } from '../lib/kit.js';
import { signOn, bin, bollard, bikeRack, pottedPlant, sculpture, car, CAR_COLORS, parkingBay } from '../lib/props.js';

export const OFFICE_VARIANTS = [
  { glass: 0x7fb3c8, fin: 0xe9e4da, stone: 0xd8cfbd, accent: 0x3f8d8a, name: 'TIDE', tree: 'round' },
  { glass: 0x8fc5c0, fin: 0xd9805f, stone: 0xe0d6c2, accent: 0xd8735b, name: 'NOVA', tree: 'palm' },
  { glass: 0xa8b8c8, fin: 0xc9a46a, stone: 0xcfc6b4, accent: 0xc9a46a, name: 'HELIX', tree: 'lime' },
];
const FLOOR = 0.36, PODIUM = 0.58, FLOORS = 8;

export function buildOffice(group, variantIndex, seed) {
  const v = OFFICE_VARIANTS[variantIndex % OFFICE_VARIANTS.length];
  const random = rng(seed);
  plate(group, 4, 4, 0x86ad70);
  box(group, 0.08, 0, 2.9, 3.84, 0.014, 1.02, pavingMat(0xe7decb));
  box(group, 3.0, 0, 0.12, 0.88, 0.014, 2.7, pavingMat(0xdcd2bd));
  // Podium (two storeys of stone with a glazed lobby).
  const px0 = 0.35, px1 = 3.0, pz0 = 0.35, pz1 = 2.85;
  box(group, px0 - 0.04, 0, pz0 - 0.04, px1 - px0 + 0.08, 0.07, pz1 - pz0 + 0.08, stoneMat(v.stone));
  box(group, px0, 0.06, pz0, px1 - px0, PODIUM - 0.06, pz1 - pz0, stoneMat(v.stone));
  const lobbyGlass = glass(0xb5d6dc);
  for (let i = 0; i < 7; i += 1) {
    const pane = box(group, px0 + 0.12 + i * 0.35, 0.08, pz1, 0.32, PODIUM - 0.16, 0.012, lobbyGlass);
    pane.userData.window = true; pane.userData.lit = true;
    box(group, px0 + 0.1 + i * 0.35, 0.07, pz1 - 0.005, 0.022, PODIUM - 0.14, 0.025, mat(P.charcoal, { metal: 0.5, rough: 0.35 }));
  }
  for (let i = 0; i < 6; i += 1) {
    const pane = box(group, px1, 0.08, pz0 + 0.12 + i * 0.38, 0.012, PODIUM - 0.16, 0.34, lobbyGlass);
    pane.userData.window = true; pane.userData.lit = i % 2 === 0;
  }
  // Entrance canopy and revolving door.
  box(group, 1.2, PODIUM - 0.14, pz1, 1.0, 0.035, 0.42, mat(v.accent, { rough: 0.45, metal: 0.3 }));
  cylinder(group, 1.7, 0.06, pz1 + 0.06, 0.12, 0.12, 0.32, glass(0xcfe6ea), 20);
  signOn(group, 'south', pz1 + 0.42, 1.35, PODIUM - 0.11, 0.7, 0.07, `${v.name} HOUSE`, { bg: '#1f2a2e', fg: '#f6f2e8', font: '700 56px Verdana, sans-serif' });
  // Tower: curtain-wall floors set back from the podium.
  const tx0 = 0.6, tx1 = 2.8, tz0 = 0.55, tz1 = 2.6;
  const towerTop = PODIUM + FLOORS * FLOOR;
  box(group, tx0, PODIUM, tz0, tx1 - tx0, FLOORS * FLOOR, tz1 - tz0, concreteMat(0x4a5560));
  const curtain = glass(v.glass);
  const bays = 6;
  for (let f = 0; f < FLOORS; f += 1) {
    const y = PODIUM + f * FLOOR;
    for (let b = 0; b < bays; b += 1) {
      const sw = (tx1 - tx0 - 0.08) / bays, swz = (tz1 - tz0 - 0.08) / bays;
      const s = box(group, tx0 + 0.04 + b * sw + 0.012, y + 0.04, tz1, sw - 0.024, FLOOR - 0.07, 0.012, curtain);
      s.userData.window = true; s.userData.lit = ((f * 7 + b * 3 + variantIndex) % 5) > 1;
      const e = box(group, tx1, y + 0.04, tz0 + 0.04 + b * swz + 0.012, 0.012, FLOOR - 0.07, swz - 0.024, curtain);
      e.userData.window = true; e.userData.lit = ((f * 5 + b * 7 + variantIndex) % 5) > 1;
    }
    // Spandrel bands between floors.
    box(group, tx0 - 0.005, y, tz1 - 0.005, tx1 - tx0 + 0.01, 0.04, 0.03, mat(0xe9e6df, { rough: 0.5 }));
    box(group, tx1 - 0.005, y, tz0 - 0.005, 0.03, 0.04, tz1 - tz0 + 0.01, mat(0xe9e6df, { rough: 0.5 }));
  }
  // Vertical accent fins framing the facade.
  const finMat = mat(v.fin, { rough: 0.5, metal: 0.2 });
  for (const fx of [tx0 - 0.02, tx0 + (tx1 - tx0) / 2 - 0.02, tx1 - 0.04]) box(group, fx, PODIUM, tz1 - 0.01, 0.06, FLOORS * FLOOR + 0.1, 0.06, finMat);
  for (const fz of [tz0 + (tz1 - tz0) / 2 - 0.02]) box(group, tx1 - 0.01, PODIUM, fz, 0.06, FLOORS * FLOOR + 0.1, 0.06, finMat);
  // Crown: setback top floor, company panel, plant, mast and a roof garden on the podium.
  flatRoof(group, tx0, tz0, tx1, tz1, towerTop, { h: 0.08, color: 0xe9e6df, deck: 0xa9aaa8 });
  box(group, tx0 + 0.25, towerTop + 0.06, tz0 + 0.25, tx1 - tx0 - 0.5, 0.32, tz1 - tz0 - 0.5, renderMat(0xf1eee8));
  signOn(group, 'south', tz1 - 0.25, tx0 + 0.45, towerTop + 0.12, tx1 - tx0 - 0.9, 0.18, v.name, { bg: '#ffffff', fg: '#' + v.accent.toString(16).padStart(6, '0'), font: '900 88px Verdana, sans-serif', frame: 0xe9e6df });
  for (const [ux, uz] of [[tx0 + 0.35, tz0 + 0.35], [tx0 + 0.75, tz0 + 0.35]]) { box(group, ux, towerTop + 0.38, uz, 0.25, 0.14, 0.22, mat(0xd8d6d0, { rough: 0.6 }), 0.01); cylinder(group, ux + 0.12, towerTop + 0.52, uz + 0.11, 0.07, 0.07, 0.01, mat(0x4a5258), 16); }
  cylinder(group, tx1 - 0.55, towerTop + 0.38, tz0 + 0.45, 0.012, 0.018, 0.5, mat(0xc9ccd0, { metal: 0.7, rough: 0.3 }), 8);
  const beacon = sphere(group, tx1 - 0.55, towerTop + 0.9, tz0 + 0.45, 0.02, mat(0xff5a4a, { emissive: 0x661a10 }), 1); beacon.userData.lamp = true;
  // Podium roof garden (front and east ledges around the tower).
  box(group, px0 + 0.02, PODIUM, pz0 + 0.02, px1 - px0 - 0.04, 0.03, pz1 - pz0 - 0.04, concreteMat(0xcfc9bc));
  const ledge = new THREE.Group(); ledge.position.y = PODIUM + 0.03; group.add(ledge);
  planter(ledge, px0 + 0.08, pz1 - 0.2, px1 - px0 - 0.16, 0.12, random, { h: 0.08 });
  planter(ledge, px1 - 0.17, pz0 + 0.1, 0.1, pz1 - pz0 - 0.35, random, { h: 0.08 });
  // Plaza: tree planters, benches, sculpture, bollards, bikes; a few visitor cars on the east lane.
  for (const tx of [0.35, 1.0, 2.55, 3.25]) {
    box(group, tx - 0.15, 0, 3.2, 0.3, 0.08, 0.3, stoneMat(0xd8cdb6), 0.01);
    if (v.tree === 'palm') palm(group, tx, 3.35, random, { scale: 1.3 }); else broadleaf(group, tx, 3.35, random, { scale: 1.1, leaves: v.tree });
  }
  for (const bx of [0.6, 2.75]) bench(group, bx, 3.75, 'x');
  sculpture(group, 1.75, 3.45, v.accent);
  for (let i = 0; i < 8; i += 1) bollard(group, 0.3 + i * 0.48, 3.92);
  bikeRack(group, 3.1, 2.95, 4, random);
  bin(group, 1.35, 3.8); bin(group, 2.15, 3.8);
  for (const pxp of [1.15, 2.25]) pottedPlant(group, pxp, pz1 + 0.55, random, 1.4);
  parkingBay(group, 3.12, 0.25, 0.75, 1.9, 'z');
  for (let i = 0; i < 6; i += 1) if (i !== 2) car(group, 3.5, 0.4 + i * 0.3, 0, CAR_COLORS[(i * 3 + variantIndex) % CAR_COLORS.length], random);
  hedge(group, 3.92, 0.1, 2.75, 'z', { h: 0.1, w: 0.07 });
  poplar(group, 0.15, 0.2, random, { scale: 1.2 }); poplar(group, 0.15, 0.7, random, { scale: 1.05 });
  broadleaf(group, 0.18, 1.6, random, { scale: 1.1, leaves: 'deep' });
  flowerbed(group, 0.1, 2.4, 0.22, 0.4, random);
  shrub(group, 3.8, 2.8, random, { scale: 1.2, flowers: P.gold });
  return group;
}

export function officeAssets() {
  return OFFICE_VARIANTS.flatMap((_, index) => ['S', 'E'].map((front) => ({
    id: `office.v${index}.${front}`, kind: 'office', variant: index, front, footprint: { w: 4, d: 4 },
    build: (g) => buildOffice(g, index, 8000 + index * 43),
  })));
}
