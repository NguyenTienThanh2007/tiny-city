// Road tiles for every connection mask (N = 1, E = 2, S = 4, W = 8; N is grid y − 1 = −Z, E is +X).
// Asphalt reaches the tile edge on connected sides; open sides get a raised paved sidewalk with a stone curb.
// Geometry overlaps the tile by EPS so neighbouring tiles join without hairline seams.
import { PALETTE as P, mat, box, cylinder } from '../lib/kit.js';

const EPS = 0.02;
const INSET = 0.2;
const CURB_H = 0.024;

export const ROAD_BITS = { N: 1, E: 2, S: 4, W: 8 };

function buildRoad(group, mask) {
  const n = mask & 1, e = mask & 2, s = mask & 4, w = mask & 8;
  const asphalt = mat(0x5f6b73, { rough: 0.95, tex: 'asphalt' });
  const paving = mat(0xe6dccb, { rough: 0.95, tex: 'paving', texScale: 0.55 });
  const curb = mat(0xcfc9bd, { rough: 0.8, tex: 'stone', texScale: 0.3 });
  const seam = mat(0xcfc5b1, { rough: 1 });
  const lo = -EPS, hi = 1 + EPS;
  // Asphalt everywhere first (slightly below the sidewalk top).
  box(group, lo, -0.02, lo, hi - lo, 0.02, hi - lo, asphalt);
  // Sidewalk pieces: four corners always, plus a strip on each open side.
  const walk = (x0, z0, x1, z1) => {
    box(group, x0, 0, z0, x1 - x0, CURB_H, z1 - z0, paving);
    void seam;
  };
  const a = INSET, b = 1 - INSET;
  walk(lo, lo, a, a); walk(b, lo, hi, a); walk(lo, b, a, hi); walk(b, b, hi, hi);
  if (!n) walk(a, lo, b, a);
  if (!s) walk(a, b, b, hi);
  if (!w) walk(lo, a, a, b);
  if (!e) walk(b, a, hi, b);
  // Curb stones along every sidewalk edge that faces asphalt.
  const c = 0.03;
  const curbX = (x0, x1, z) => box(group, x0, 0, z - c / 2, x1 - x0, CURB_H + 0.004, c, curb);
  const curbZ = (z0, z1, x) => box(group, x - c / 2, 0, z0, c, CURB_H + 0.004, z1 - z0, curb);
  if (!n) curbX(n ? a : a, b, a); else { curbZ(lo, a, a); curbZ(lo, a, b); }
  if (!s) curbX(a, b, b); else { curbZ(b, hi, a); curbZ(b, hi, b); }
  if (!w) curbZ(a, b, a); else { curbX(lo, a, a); curbX(lo, a, b); }
  if (!e) curbZ(a, b, b); else { curbX(b, hi, a); curbX(b, hi, b); }
  const links = [n, e, s, w].filter(Boolean).length;
  const mark = mat(0xf4ead0, { rough: 0.6 });
  const white = mat(0xf7f4ea, { rough: 0.6 });
  if (links >= 3) {
    // Zebra crossings on every approach, just inside the tile edge.
    const zebra = (horizontal, z0) => {
      for (let i = 0; i < 5; i += 1) {
        const t = a + 0.04 + i * ((b - a - 0.08) / 4) - 0.025;
        if (horizontal) box(group, t, 0.0005, z0, 0.05, 0.002, 0.13, white);
        else box(group, z0, 0.0005, t, 0.13, 0.002, 0.05, white);
      }
    };
    if (n) zebra(true, 0.02); if (s) zebra(true, 0.85); if (w) zebra(false, 0.02); if (e) zebra(false, 0.85);
  } else if (links === 2 && ((n && s) || (e && w))) {
    // Dashed centre line.
    for (const t of [0.08, 0.58]) {
      if (n) box(group, 0.49, 0.0005, t, 0.022, 0.002, 0.3, mark);
      else box(group, t, 0.0005, 0.49, 0.3, 0.002, 0.022, mark);
    }
  } else if (links === 0) {
    box(group, 0.4, 0.0005, 0.4, 0.2, 0.002, 0.2, mark);
  }
  // A drain grate on the curb side of straights and a manhole cover in junctions.
  if (links >= 3) box(group, 0.44, 0.0008, 0.44, 0.12, 0.002, 0.12, mat(0x4f5a60, { rough: 0.6, metal: 0.4 }));
  return group;
}

/** Pedestrian plaza: a road tile whose eight neighbours are all road, drawn as decorative cobbled paving. */
function buildPlaza(group) {
  const lo = -EPS, hi = 1 + EPS;
  box(group, lo, -0.02, lo, hi - lo, 0.03, hi - lo, mat(0xe2d3bb, { rough: 0.95, tex: 'cobble', texScale: 0.8 }));
  // A paving rosette in the centre of each tile keeps large plazas from looking flat.
  cylinder(group, 0.5, 0.01, 0.5, 0.22, 0.22, 0.004, mat(0xc9a882, { rough: 0.9, tex: 'paving', texScale: 0.35 }), 24);
  cylinder(group, 0.5, 0.012, 0.5, 0.12, 0.12, 0.004, mat(0xe9dcc4, { rough: 0.9 }), 24);
  return group;
}

export function roadAssets() {
  return Array.from({ length: 16 }, (_, mask) => ({ id: `road.m${mask}`, kind: 'road', category: 'road', variant: 0, mask, tile: true,
    footprint: { w: 1, d: 1 }, shadow: false, emissive: false, build: (g) => buildRoad(g, mask) }))
    .concat([{ id: 'road.plaza', kind: 'road', category: 'road', variant: 1, mask: 15, plaza: true, tile: true, footprint: { w: 1, d: 1 }, shadow: false, emissive: false, build: (g) => buildPlaza(g) }]);
}
