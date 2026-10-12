import type { Graphics } from 'pixi.js';
import { BUILDINGS, type Building, type BuildingKind } from '../types';
import { footprint, iso, type Point } from './mapGeometry';

/**
 * Vector art for catalog buildings. Geometry heights (`buildingLift`) are shared with hit testing, so the
 * clickable roof stays where it is drawn.
 */

export function polygon(graphics: Graphics, points: Point[], color: number, alpha = 1, stroke?: number, strokeAlpha = 0.28) {
  graphics.poly(points.flatMap((point) => [point.x, point.y])).fill({ color, alpha });
  if (stroke !== undefined) graphics.poly(points.flatMap((point) => [point.x, point.y])).stroke({ color: stroke, width: 1, alpha: strokeAlpha });
}

const blockHeights: Partial<Record<BuildingKind, number>> = { duplex: 35, townhouse: 40, apartment: 82, mall: 34, office: 96 };

export function buildingLift(building: Pick<Building, 'kind'>, progress: number): number {
  switch (building.kind) {
    case 'villa': return Math.min(30, 9 + progress * 21);
    case 'duplex': return 5 + 35 * Math.max(0.08, progress);
    case 'townhouse': return 5 + 40 * Math.max(0.08, progress);
    case 'apartment': return 5 + 82 * Math.max(0.08, progress);
    case 'park':
    case 'pool': return 5;
    case 'clubhouse': return 40;
    default: return 5 + (blockHeights[building.kind] ?? 0) * Math.max(0.08, progress);
  }
}

const up = (point: Point, height: number): Point => ({ x: point.x, y: point.y - height });
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Quad on a vertical wall between ground corners a→b: u along the wall, v as height. */
function wallQuad(a: Point, b: Point, u1: number, u2: number, v1: number, v2: number): Point[] {
  const p1 = lerp(a, b, u1), p2 = lerp(a, b, u2);
  return [up(p1, v1), up(p2, v1), up(p2, v2), up(p1, v2)];
}

function shade(color: number, amount: number): number {
  const channel = (shift: number) => Math.max(0, Math.min(255, Math.round(((color >> shift) & 0xff) * amount)));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

interface MassStyle { wall: number; roof: number; trim?: number }

/** Two visible walls (front-left, front-right) and a flat top; returns the top polygon. */
function drawMass(g: Graphics, ground: Point[], height: number, style: MassStyle): Point[] {
  const top = ground.map((point) => up(point, height));
  polygon(g, ground, 0x22382b, 0.22);
  polygon(g, [ground[3], ground[2], top[2], top[3]], style.wall, 1, shade(style.wall, 0.7), 0.35);
  polygon(g, [ground[2], ground[1], top[1], top[2]], shade(style.wall, 0.8), 1, shade(style.wall, 0.6), 0.35);
  polygon(g, top, style.roof, 1, shade(style.roof, 0.75), 0.5);
  if (style.trim !== undefined) {
    g.moveTo(top[3].x, top[3].y).lineTo(top[2].x, top[2].y).lineTo(top[1].x, top[1].y)
      .stroke({ color: style.trim, width: 1.4, alpha: 0.8 });
  }
  return top;
}

/** Hip roof rising from the wall tops; long axis follows the footprint. */
function drawHipRoof(g: Graphics, building: Building, wallHeight: number, rise: number, color: number) {
  const spec = BUILDINGS[building.kind];
  const { x, y } = building;
  const w = spec.width, h = spec.height;
  const overhang = 0.12;
  const P = (gx: number, gy: number, height: number) => up(iso(gx, gy), height);
  const x0 = x - overhang, y0 = y - overhang, x1 = x + w + overhang, y1 = y + h + overhang;
  const alongX = w >= h;
  const half = (alongX ? h : w) / 2 + overhang;
  const r1 = alongX ? P(x0 + half, (y0 + y1) / 2, wallHeight + rise) : P((x0 + x1) / 2, y0 + half, wallHeight + rise);
  const r2 = alongX ? P(x1 - half, (y0 + y1) / 2, wallHeight + rise) : P((x0 + x1) / 2, y1 - half, wallHeight + rise);
  const c00 = P(x0, y0, wallHeight), c10 = P(x1, y0, wallHeight), c11 = P(x1, y1, wallHeight), c01 = P(x0, y1, wallHeight);
  const light = shade(color, 1.08), mid = color, dark = shade(color, 0.78);
  if (alongX) {
    polygon(g, [c00, c10, r2, r1], mid, 1, dark, 0.4); // north slope
    polygon(g, [c00, r1, c01], light, 1, dark, 0.4); // west hip
    polygon(g, [c01, c11, r2, r1], light, 1, dark, 0.5); // south slope
    polygon(g, [c10, c11, r2], dark, 1, dark, 0.5); // east hip
  } else {
    polygon(g, [c00, c10, r1], mid, 1, dark, 0.4);
    polygon(g, [c00, r1, r2, c01], light, 1, dark, 0.4);
    polygon(g, [c01, c11, r2], light, 1, dark, 0.5);
    polygon(g, [c10, c11, r2, r1], dark, 1, dark, 0.5);
  }
  g.moveTo(r1.x, r1.y).lineTo(r2.x, r2.y).stroke({ color: shade(color, 1.2), width: 1.2, alpha: 0.7 });
}

function windowsOnWall(g: Graphics, a: Point, b: Point, count: number, floors: number, baseHeight: number, floorHeight: number,
  color: number, frame = 0xf6efe0) {
  for (let floor = 0; floor < floors; floor += 1) {
    for (let index = 0; index < count; index += 1) {
      const u1 = (index + 0.28) / count, u2 = (index + 0.72) / count;
      const v1 = baseHeight + floor * floorHeight, v2 = v1 + floorHeight * 0.52;
      const quad = wallQuad(a, b, u1, u2, v1, v2);
      polygon(g, quad, frame, 0.85);
      polygon(g, wallQuad(a, b, u1 + 0.02 / count, u2 - 0.02 / count, v1 + 0.6, v2 - 0.6), color, 1);
    }
  }
}

function door(g: Graphics, a: Point, b: Point, u: number, width: number, height: number, color: number) {
  polygon(g, wallQuad(a, b, u - width / 2, u + width / 2, 0, height), color, 1);
}

function tree(g: Graphics, point: Point, size = 1, palm = false) {
  g.ellipse(point.x + 2, point.y + 1, 6 * size, 2.6 * size).fill({ color: 0x1f3324, alpha: 0.22 });
  if (palm) {
    g.moveTo(point.x, point.y).quadraticCurveTo(point.x + 3 * size, point.y - 9 * size, point.x + 1 * size, point.y - 17 * size)
      .stroke({ color: 0x8a6a48, width: 2 * size });
    const top = { x: point.x + 1 * size, y: point.y - 17 * size };
    for (const [dx, dy] of [[-8, 2], [8, 3], [-5, -4], [6, -4], [0, -6]] as const) {
      g.moveTo(top.x, top.y).quadraticCurveTo(top.x + dx * 0.5 * size, top.y + (dy - 3) * size, top.x + dx * size, top.y + dy * size)
        .stroke({ color: 0x3f7f55, width: 2.2 * size, cap: 'round' });
    }
    return;
  }
  g.rect(point.x - 1.1 * size, point.y - 9 * size, 2.2 * size, 9 * size).fill(0x76583d);
  g.circle(point.x, point.y - 13 * size, 6.6 * size).fill(0x3e7a56);
  g.circle(point.x - 3 * size, point.y - 11 * size, 4.2 * size).fill(0x4f8d61);
  g.circle(point.x + 2.4 * size, point.y - 15.2 * size, 3.2 * size).fill(0x67a273);
}

function drawHouse(g: Graphics, building: Building, progress: number, options: { wall: number; roof: number; floors: number; windows: number; palm?: boolean }) {
  const spec = BUILDINGS[building.kind];
  const ground = footprint(building.x, building.y, spec.width, spec.height);
  const total = buildingLift(building, progress);
  const roofRise = Math.min(16, total * 0.42);
  const wallHeight = progress < 0.62 ? total : total - roofRise * 0.55;
  drawMass(g, ground, wallHeight, { wall: options.wall, roof: shade(options.wall, 0.9) });
  const floorHeight = Math.max(6, (wallHeight - 3) / options.floors);
  windowsOnWall(g, ground[3], ground[2], Math.max(1, Math.round(spec.width * options.windows)), options.floors, 3, floorHeight, 0x9fc9c6);
  windowsOnWall(g, ground[2], ground[1], Math.max(1, Math.round(spec.height * options.windows)), options.floors, 3, floorHeight, 0x86b2b2);
  if (progress >= 0.62) {
    door(g, ground[3], ground[2], 0.5, 0.16 / Math.max(1, spec.width / 2), Math.min(11, floorHeight * 0.9), 0x8a6248);
    drawHipRoof(g, building, wallHeight, roofRise, options.roof);
    const yard = iso(building.x + spec.width - 0.28, building.y + spec.height - 0.22);
    tree(g, yard, 0.75, options.palm);
  }
}

function drawTower(g: Graphics, building: Building, progress: number, options: { wall: number; roof: number; glass: number; floors: number; columns: number; balconies?: boolean }) {
  const spec = BUILDINGS[building.kind];
  const ground = footprint(building.x, building.y, spec.width, spec.height);
  const height = buildingLift(building, progress);
  const top = drawMass(g, ground, height, { wall: options.wall, roof: options.roof, trim: 0xf6f0e2 });
  const floors = Math.max(1, Math.round(options.floors * Math.min(1, progress + 0.1)));
  const floorHeight = (height - 6) / Math.max(1, floors);
  for (const [a, b, columns, color] of [[ground[3], ground[2], options.columns, options.glass], [ground[2], ground[1], options.columns, shade(options.glass, 0.85)]] as const) {
    for (let floor = 0; floor < floors; floor += 1) {
      const v1 = 4 + floor * floorHeight, v2 = v1 + floorHeight * 0.62;
      polygon(g, wallQuad(a, b, 0.06, 0.94, v1, v2), color, 0.95);
      for (let column = 1; column < columns; column += 1) {
        const u = 0.06 + 0.88 * column / columns;
        const p1 = up(lerp(a, b, u), v1), p2 = up(lerp(a, b, u), v2);
        g.moveTo(p1.x, p1.y).lineTo(p2.x, p2.y).stroke({ color: shade(options.wall, 1.05), width: 0.8, alpha: 0.85 });
      }
      if (options.balconies && floor % 2 === 1) {
        const p1 = up(lerp(a, b, 0.06), v1), p2 = up(lerp(a, b, 0.94), v1);
        g.moveTo(p1.x, p1.y).lineTo(p2.x, p2.y).stroke({ color: 0xf6f0e2, width: 1.6, alpha: 0.9 });
      }
    }
  }
  if (progress >= 0.9) {
    const centerTop = { x: (top[0].x + top[2].x) / 2, y: (top[0].y + top[2].y) / 2 };
    polygon(g, [lerp(top[0], centerTop, 0.45), lerp(top[1], centerTop, 0.45), lerp(top[2], centerTop, 0.45), lerp(top[3], centerTop, 0.45)],
      shade(options.roof, 0.85), 1);
    if (options.balconies) {
      g.circle(centerTop.x - 8, centerTop.y + 1, 3.2).fill(0x5f9a62).circle(centerTop.x + 6, centerTop.y - 1, 2.6).fill(0x4f8d61);
    } else {
      polygon(g, [up(centerTop, 0), up({ x: centerTop.x + 8, y: centerTop.y + 4 }, 0), up({ x: centerTop.x + 8, y: centerTop.y + 4 }, 6), up(centerTop, 6)], 0xb9c4c2, 1);
    }
  }
}

function drawPark(g: Graphics, building: Building) {
  const spec = BUILDINGS.park;
  const ground = footprint(building.x, building.y, spec.width, spec.height);
  const upper = ground.map((point) => up(point, 4));
  polygon(g, [ground[3], ground[2], upper[2], upper[3]], 0x6e8f5f);
  polygon(g, [ground[2], ground[1], upper[1], upper[2]], 0x5d7f51);
  polygon(g, upper, 0x8dbb76, 1, 0x5f8a58, 0.45);
  const P = (dx: number, dy: number) => up(iso(building.x + dx, building.y + dy), 4);
  // Curving path and a small pond.
  g.moveTo(P(0, 2.2).x, P(0, 2.2).y).quadraticCurveTo(P(2, 1.4).x, P(2, 1.4).y, P(4, 2.4).x, P(4, 2.4).y)
    .stroke({ color: 0xe8d9b0, width: 4.2, cap: 'round' });
  g.moveTo(P(2, 0).x, P(2, 0).y).quadraticCurveTo(P(2.4, 2).x, P(2.4, 2).y, P(1.8, 4).x, P(1.8, 4).y)
    .stroke({ color: 0xe8d9b0, width: 3.4, cap: 'round' });
  const pond = P(2.9, 3.0);
  g.ellipse(pond.x, pond.y, 13, 6).fill(0x6fb6bf).ellipse(pond.x - 2, pond.y - 1, 8, 3).fill({ color: 0xd8f4ea, alpha: 0.4 });
  const bench = P(1.1, 1.3);
  g.roundRect(bench.x - 5, bench.y - 3, 10, 2.4, 1).fill(0x9b6f4a);
  for (const [dx, dy, size] of [[0.6, 0.7, 1], [3.3, 0.8, 0.9], [0.8, 3.3, 1.05], [3.4, 1.9, 0.8], [1.4, 2.6, 0.7]] as const) tree(g, P(dx, dy), size);
  for (const [dx, dy] of [[1.6, 0.4], [2.7, 1.2], [0.4, 2.9], [3.6, 3.6]] as const) {
    const flower = P(dx, dy);
    g.circle(flower.x, flower.y, 1.4).fill(0xf2c14e).circle(flower.x + 3, flower.y + 1, 1.2).fill(0xe58f7a);
  }
}

function drawPool(g: Graphics, building: Building) {
  const spec = BUILDINGS.pool;
  const ground = footprint(building.x, building.y, spec.width, spec.height);
  const deck = ground.map((point) => up(point, 5));
  polygon(g, [ground[3], ground[2], deck[2], deck[3]], 0xd8ccb0);
  polygon(g, [ground[2], ground[1], deck[1], deck[2]], 0xc2b496);
  polygon(g, deck, 0xeee2c6, 1, 0xc9b994, 0.6);
  const P = (dx: number, dy: number) => up(iso(building.x + dx, building.y + dy), 5);
  const water = [P(0.5, 0.6), P(2.5, 0.6), P(2.5, 3.1), P(0.5, 3.1)];
  polygon(g, water, 0x4fb3c2, 1, 0xf7f2e2, 0.95);
  const center = P(1.5, 1.85);
  g.moveTo(center.x - 20, center.y - 2).quadraticCurveTo(center.x, center.y - 7, center.x + 20, center.y - 1)
    .stroke({ color: 0xd8f4ea, width: 1.6, alpha: 0.8 });
  g.moveTo(center.x - 16, center.y + 6).quadraticCurveTo(center.x, center.y + 2, center.x + 16, center.y + 7)
    .stroke({ color: 0xd8f4ea, width: 1.2, alpha: 0.7 });
  for (const dy of [0.9, 1.9, 2.9]) {
    const lounger = P(2.78, dy);
    g.roundRect(lounger.x - 5, lounger.y - 2, 10, 3, 1.2).fill(0xf7f2e2).roundRect(lounger.x - 5, lounger.y - 2, 3.6, 3, 1).fill(0xe58f7a);
  }
  const umbrella = P(2.8, 3.6);
  g.moveTo(umbrella.x, umbrella.y).lineTo(umbrella.x, umbrella.y - 14).stroke({ color: 0x8a6a48, width: 1.2 });
  g.poly([umbrella.x - 9, umbrella.y - 12, umbrella.x, umbrella.y - 18, umbrella.x + 9, umbrella.y - 12]).fill(0xc8714f);
}

function drawClubhouse(g: Graphics, building: Building) {
  const spec = BUILDINGS.clubhouse;
  const ground = footprint(building.x, building.y, spec.width, spec.height);
  const wallHeight = 26;
  const top = drawMass(g, ground, wallHeight, { wall: 0xeedcbc, roof: 0xd9c7a2 });
  windowsOnWall(g, ground[3], ground[2], 3, 1, 6, 16, 0x9fc9c6);
  windowsOnWall(g, ground[2], ground[1], 2, 1, 6, 16, 0x86b2b2);
  door(g, ground[3], ground[2], 0.5, 0.14, 13, 0x6b4f3b);
  // Terracotta pergola terrace roof up to the shared 40-unit lift.
  const roof = ground.map((point) => up(point, 40));
  for (let index = 0; index <= 6; index += 1) {
    const a = lerp(roof[3], roof[0], index / 6), b = lerp(roof[2], roof[1], index / 6);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0xc8714f, width: 2.2, alpha: 0.95 });
  }
  g.moveTo(roof[3].x, roof[3].y).lineTo(roof[2].x, roof[2].y).lineTo(roof[1].x, roof[1].y).stroke({ color: 0xa65a3d, width: 2.4 });
  for (const corner of [roof[3], roof[2], roof[1]]) {
    const base = { x: corner.x, y: corner.y + 40 - wallHeight };
    g.moveTo(base.x, base.y).lineTo(corner.x, corner.y).stroke({ color: 0xf6f0e2, width: 1.6 });
  }
  const sign = lerp(top[3], top[2], 0.5);
  g.roundRect(sign.x - 13, sign.y + 3, 26, 5, 2).fill(0x2f4a3a);
  g.roundRect(sign.x - 10, sign.y + 4.5, 20, 2, 1).fill(0xf2c14e);
  tree(g, iso(building.x + 0.3, building.y + spec.height - 0.3), 0.85, true);
}

function drawMall(g: Graphics, building: Building, progress: number) {
  const spec = BUILDINGS.mall;
  const ground = footprint(building.x, building.y, spec.width, spec.height);
  const height = buildingLift(building, progress);
  const top = drawMass(g, ground, height, { wall: 0xe9e2d2, roof: 0xd8d4c6, trim: 0xf7f2e2 });
  for (const [a, b, color] of [[ground[3], ground[2], 0x7fb7bb], [ground[2], ground[1], 0x6ea3a8]] as const) {
    polygon(g, wallQuad(a, b, 0.05, 0.95, 4, Math.max(8, height * 0.45)), color, 0.95);
    polygon(g, wallQuad(a, b, 0.05, 0.95, Math.max(10, height * 0.62), Math.max(13, height * 0.78)), 0xc8714f, 0.9);
  }
  if (progress >= 0.9) {
    const sign = lerp(ground[3], ground[2], 0.5);
    g.roundRect(sign.x - 16, sign.y - height * 0.74, 32, 6, 2).fill(0xf7f2e2);
    g.roundRect(sign.x - 13, sign.y - height * 0.74 + 2, 26, 2, 1).fill(0xc8714f);
    const center = { x: (top[0].x + top[2].x) / 2, y: (top[0].y + top[2].y) / 2 };
    for (const [dx, dy] of [[-22, 0], [0, -6], [18, 4]] as const) {
      g.roundRect(center.x + dx - 6, center.y + dy - 5, 12, 6, 1.5).fill(0xb9c4c2).roundRect(center.x + dx - 6, center.y + dy - 5, 12, 2, 1).fill(0xd8dedc);
    }
  }
}

export function drawBuildingArt(graphics: Graphics, building: Building, progress: number) {
  switch (building.kind) {
    case 'villa': drawHouse(graphics, building, progress, { wall: 0xf1e3c6, roof: 0xc8714f, floors: 1, windows: 0.9, palm: true }); break;
    case 'duplex': drawHouse(graphics, building, progress, { wall: 0xe9d7b4, roof: 0xb45f45, floors: 2, windows: 0.8 }); break;
    case 'townhouse': drawHouse(graphics, building, progress, { wall: 0xe3cfae, roof: 0x9c5a46, floors: 3, windows: 0.75 }); break;
    case 'apartment': drawTower(graphics, building, progress, { wall: 0xdfe3d6, roof: 0xc9cdbf, glass: 0x8fbcc0, floors: 6, columns: 4, balconies: true }); break;
    case 'park': drawPark(graphics, building); break;
    case 'clubhouse': drawClubhouse(graphics, building); break;
    case 'pool': drawPool(graphics, building); break;
    case 'mall': drawMall(graphics, building, progress); break;
    case 'office': drawTower(graphics, building, progress, { wall: 0xc9d6d8, roof: 0xaebfc3, glass: 0x5d93a6, floors: 8, columns: 5 }); break;
  }
}

/** Extra clickable cap above flat tops, matching pitched roofs and rooftop details. */
export function roofCapHeight(kind: BuildingKind): number {
  return kind === 'villa' || kind === 'duplex' || kind === 'townhouse' ? 8 : 4;
}
