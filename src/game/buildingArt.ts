import type { Graphics } from 'pixi.js';
import { BUILDINGS, type Building, type BuildingKind } from '../types';
import { footprint, iso, type Point } from './mapGeometry';
import { buildingVariant, shade, windowLit, type BuildingVariant } from './buildingVariants';

/**
 * Vector art for catalog buildings. Geometry heights (`buildingLift`) are shared with hit testing, so the
 * clickable roof stays where it is drawn. Variants come from the stable building ID; nothing here is random.
 */

export function polygon(graphics: Graphics, points: Point[], color: number, alpha = 1, stroke?: number, strokeAlpha = 0.28) {
  graphics.poly(points.flatMap((point) => [point.x, point.y])).fill({ color, alpha });
  if (stroke !== undefined) graphics.poly(points.flatMap((point) => [point.x, point.y])).stroke({ color: stroke, width: 1, alpha: strokeAlpha });
}

const blockHeights: Partial<Record<BuildingKind, number>> = { duplex: 35, townhouse: 40, apartment: 82, mall: 34, office: 96,
  // Phase 7 venues (the stage and the amusement park are mostly open ground with a tall feature).
  cafe: 24, shops: 30, market: 12, cinema: 46, nightclub: 34, stage: 26, amusement: 30 };

export function buildingLift(building: Pick<Building, 'kind'>, progress: number): number {
  switch (building.kind) {
    case 'villa': return Math.min(30, 9 + progress * 21);
    case 'duplex': return 5 + 35 * Math.max(0.08, progress);
    case 'townhouse': return 5 + 40 * Math.max(0.08, progress);
    case 'apartment': return 5 + 82 * Math.max(0.08, progress);
    case 'park':
    case 'pool':
    case 'plaza': return 5;
    case 'clubhouse': return 40;
    default: return 5 + (blockHeights[building.kind] ?? 0) * Math.max(0.08, progress);
  }
}

/** Extra clickable cap above flat tops, matching pitched roofs and rooftop details. */
export function roofCapHeight(kind: BuildingKind): number {
  return kind === 'villa' || kind === 'duplex' || kind === 'townhouse' ? 8 : 4;
}

/** Which footprint edges touch a road tile; entrances and walkways face the street when it is visible. */
export interface RoadSides { readonly north: boolean; readonly south: boolean; readonly east: boolean; readonly west: boolean }
export const NO_ROAD_SIDES: RoadSides = { north: false, south: false, east: false, west: false };

export interface ArtOptions {
  readonly variant?: BuildingVariant;
  readonly roadSides?: RoadSides;
  /** Collects window quads that glow at night; drawn by the caller on an unlit layer. */
  readonly lights?: Point[][];
}

interface Art {
  readonly g: Graphics;
  readonly b: Building;
  readonly v: BuildingVariant;
  readonly sides: RoadSides;
  readonly lights: Point[][] | undefined;
  windowIndex: number;
}

const up = (point: Point, height: number): Point => ({ x: point.x, y: point.y - height });
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Quad on a vertical wall between ground corners a→b: u along the wall, v as height. */
function wallQuad(a: Point, b: Point, u1: number, u2: number, v1: number, v2: number): Point[] {
  const p1 = lerp(a, b, u1), p2 = lerp(a, b, u2);
  return [up(p1, v1), up(p2, v1), up(p2, v2), up(p1, v2)];
}

function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [], upper: Point[] = [];
  for (const p of sorted) { while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...sorted].reverse()) { while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Soft drop shadow cast down-right (sun from the upper left), sized by the building height. */
function dropShadow(g: Graphics, ground: Point[], height: number) {
  const offset = { x: height * 0.62, y: height * 0.3 };
  const hull = convexHull([...ground, ...ground.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y }))]);
  polygon(g, hull, 0x1d3326, 0.14);
  polygon(g, ground, 0x1d3326, 0.12);
}

function window(art: Art, quad: Point[], glass: number, frame = art.v.trim) {
  polygon(art.g, quad, frame, 0.92);
  const inner = [lerp(quad[0]!, quad[2]!, 0.08), lerp(quad[1]!, quad[3]!, 0.08), lerp(quad[2]!, quad[0]!, 0.08), lerp(quad[3]!, quad[1]!, 0.08)];
  polygon(art.g, inner, glass, 1);
  // A thin highlight sells the glass at normal zoom.
  art.g.moveTo(inner[0]!.x, inner[0]!.y).lineTo(lerp(inner[0]!, inner[2]!, 0.5).x, lerp(inner[0]!, inner[2]!, 0.5).y)
    .stroke({ color: 0xffffff, width: 0.6, alpha: 0.45 });
  if (art.lights && windowLit(art.v, art.windowIndex)) art.lights.push(inner);
  art.windowIndex += 1;
}

function windowsOnWall(art: Art, a: Point, b: Point, count: number, floors: number, base: number, floorHeight: number, glass: number, tall = false) {
  for (let floor = 0; floor < floors; floor += 1) {
    for (let index = 0; index < count; index += 1) {
      const u1 = (index + (tall ? 0.32 : 0.26)) / count, u2 = (index + (tall ? 0.68 : 0.74)) / count;
      const v1 = base + floor * floorHeight, v2 = v1 + floorHeight * (tall ? 0.66 : 0.5);
      window(art, wallQuad(a, b, u1, u2, v1, v2), glass);
    }
  }
}

function drawMass(g: Graphics, ground: Point[], height: number, wall: number, roof: number, trim?: number): Point[] {
  const top = ground.map((point) => up(point, height));
  polygon(g, [ground[3]!, ground[2]!, top[2]!, top[3]!], wall, 1, shade(wall, 0.62), 0.5);
  polygon(g, [ground[2]!, ground[1]!, top[1]!, top[2]!], shade(wall, 0.8), 1, shade(wall, 0.55), 0.5);
  // Plinth: a darker base course grounds the building on the lawn.
  polygon(g, [ground[3]!, ground[2]!, up(ground[2]!, 2.2), up(ground[3]!, 2.2)], shade(wall, 0.72), 1);
  polygon(g, [ground[2]!, ground[1]!, up(ground[1]!, 2.2), up(ground[2]!, 2.2)], shade(wall, 0.6), 1);
  polygon(g, top, roof, 1, shade(roof, 0.7), 0.6);
  if (trim !== undefined) {
    g.moveTo(top[3]!.x, top[3]!.y).lineTo(top[2]!.x, top[2]!.y).lineTo(top[1]!.x, top[1]!.y).stroke({ color: trim, width: 1.6, alpha: 0.9 });
  }
  // Silhouette edge on the near corner strengthens the read at small zoom.
  g.moveTo(ground[2]!.x, ground[2]!.y).lineTo(top[2]!.x, top[2]!.y).stroke({ color: shade(wall, 0.5), width: 0.8, alpha: 0.55 });
  return top;
}

function pitchedRoof(art: Art, wallHeight: number, rise: number, color: number) {
  const { g, b, v } = art;
  const spec = BUILDINGS[b.kind];
  const w = spec.width, h = spec.height, over = 0.14;
  const P = (gx: number, gy: number, height: number) => up(iso(gx, gy), height);
  const x0 = b.x - over, y0 = b.y - over, x1 = b.x + w + over, y1 = b.y + h + over;
  const alongX = w >= h;
  const hip = v.roofStyle === 'hip' || w === h;
  const half = hip ? (alongX ? h : w) / 2 + over : 0;
  const r1 = alongX ? P(x0 + half, (y0 + y1) / 2, wallHeight + rise) : P((x0 + x1) / 2, y0 + half, wallHeight + rise);
  const r2 = alongX ? P(x1 - half, (y0 + y1) / 2, wallHeight + rise) : P((x0 + x1) / 2, y1 - half, wallHeight + rise);
  const c00 = P(x0, y0, wallHeight), c10 = P(x1, y0, wallHeight), c11 = P(x1, y1, wallHeight), c01 = P(x0, y1, wallHeight);
  const light = shade(color, 1.1), mid = color, dark = shade(color, 0.74), edge = shade(color, 0.55);
  if (alongX) {
    polygon(g, [c00, c10, r2, r1], mid, 1, edge, 0.5);
    if (hip) polygon(g, [c00, r1, c01], light, 1, edge, 0.5);
    polygon(g, [c01, c11, r2, r1], light, 1, edge, 0.6);
    if (hip) polygon(g, [c10, c11, r2], dark, 1, edge, 0.6);
    else polygon(g, [up(iso(b.x + w, b.y), wallHeight), up(iso(b.x + w, b.y + h), wallHeight), r2], shade(v.wall, 0.8), 1, edge, 0.5);
  } else {
    polygon(g, [c00, c10, r1], mid, 1, edge, 0.5);
    polygon(g, [c00, r1, r2, c01], light, 1, edge, 0.5);
    if (hip) polygon(g, [c01, c11, r2], light, 1, edge, 0.6);
    else polygon(g, [up(iso(b.x, b.y + h), wallHeight), up(iso(b.x + w, b.y + h), wallHeight), r2], v.wall, 1, edge, 0.5);
    polygon(g, [c10, c11, r2, r1], dark, 1, edge, 0.6);
  }
  // Roof tile courses.
  for (let course = 1; course <= 2; course += 1) {
    const t = course / 3;
    const a = lerp(c01, r1, t), z = lerp(c11, r2, t);
    g.moveTo(a.x, a.y).lineTo(z.x, z.y).stroke({ color: dark, width: 0.7, alpha: 0.4 });
  }
  g.moveTo(r1.x, r1.y).lineTo(r2.x, r2.y).stroke({ color: shade(color, 1.25), width: 1.3, alpha: 0.75 });
  if (v.accent === 'chimney') {
    const base = P(b.x + w * 0.72, b.y + h * 0.3, wallHeight + rise * 0.55);
    polygon(g, [base, { x: base.x + 5, y: base.y + 2.5 }, { x: base.x + 5, y: base.y - 9 }, { x: base.x, y: base.y - 11.5 }], shade(v.wall, 0.75), 1, edge, 0.5);
    polygon(g, [{ x: base.x - 4, y: base.y + 0.5 }, base, { x: base.x, y: base.y - 11.5 }, { x: base.x - 4, y: base.y - 10 }], shade(v.wall, 0.9), 1, edge, 0.5);
  } else if (v.accent === 'solar') {
    const a = lerp(c01, r1, 0.25), z = lerp(c11, r2, 0.25), a2 = lerp(c01, r1, 0.7), z2 = lerp(c11, r2, 0.7);
    const panel = [lerp(a, z, 0.2), lerp(a, z, 0.7), lerp(a2, z2, 0.7), lerp(a2, z2, 0.2)];
    polygon(g, panel, 0x2f4a66, 0.95, 0x9fc3d8, 0.7);
  }
}

/** Entrance on the visible face nearest a road: south = front-left wall, east = front-right wall. */
function entranceFace(art: Art, ground: Point[]): { a: Point; b: Point; face: 'south' | 'east' } {
  return art.sides.east && !art.sides.south ? { a: ground[2]!, b: ground[1]!, face: 'east' } : { a: ground[3]!, b: ground[2]!, face: 'south' };
}

function doorway(art: Art, ground: Point[], height: number, porch: boolean) {
  const { a, b } = entranceFace(art, ground);
  const spec = BUILDINGS[art.b.kind];
  const width = 0.17 / Math.max(1, Math.max(spec.width, spec.height) / 2);
  polygon(art.g, wallQuad(a, b, 0.5 - width, 0.5 + width, 0, height + 1.5), art.v.trim, 1);
  polygon(art.g, wallQuad(a, b, 0.5 - width * 0.72, 0.5 + width * 0.72, 0, height), shade(art.v.roof, 0.62), 1);
  if (porch) {
    const awning = wallQuad(a, b, 0.5 - width * 1.6, 0.5 + width * 1.6, height + 2, height + 4.2);
    polygon(art.g, awning, art.v.awning, 1, shade(art.v.awning, 0.6), 0.6);
  }
  // Walkway from the door to the edge of the lot, only when a road actually touches that side.
  const roadOnFace = entranceFace(art, ground).face === 'south' ? art.sides.south : art.sides.east;
  if (roadOnFace) {
    const door = lerp(a, b, 0.5);
    const outward = entranceFace(art, ground).face === 'south' ? { x: -7, y: 3.5 } : { x: 7, y: 3.5 };
    art.g.moveTo(door.x, door.y).lineTo(door.x + outward.x, door.y + outward.y).stroke({ color: 0xe9dcc0, width: 5, alpha: 0.95, cap: 'round' });
  }
}

export function tree(g: Graphics, point: Point, size = 1, palm = false, tone = 0) {
  g.ellipse(point.x + 3 * size, point.y + 1, 6.5 * size, 2.8 * size).fill({ color: 0x1f3324, alpha: 0.22 });
  if (palm) {
    g.moveTo(point.x, point.y).quadraticCurveTo(point.x + 3 * size, point.y - 9 * size, point.x + 1 * size, point.y - 17 * size)
      .stroke({ color: 0x8a6a48, width: 2 * size });
    const top = { x: point.x + 1 * size, y: point.y - 17 * size };
    for (const [dx, dy] of [[-8, 2], [8, 3], [-5, -4], [6, -4], [0, -6]] as const) {
      g.moveTo(top.x, top.y).quadraticCurveTo(top.x + dx * 0.5 * size, top.y + (dy - 3) * size, top.x + dx * size, top.y + dy * size)
        .stroke({ color: tone ? 0x4f8d61 : 0x3f7f55, width: 2.2 * size, cap: 'round' });
    }
    return;
  }
  const leaves = [[0x3e7a56, 0x4f8d61, 0x67a273], [0x4a7f4c, 0x5e9459, 0x7aae6c], [0x356d55, 0x467f63, 0x5f9a78]][tone % 3]!;
  g.rect(point.x - 1.1 * size, point.y - 9 * size, 2.2 * size, 9 * size).fill(0x76583d);
  g.circle(point.x, point.y - 13 * size, 6.6 * size).fill(leaves[0]);
  g.circle(point.x - 3 * size, point.y - 11 * size, 4.2 * size).fill(leaves[1]);
  g.circle(point.x + 2.4 * size, point.y - 15.2 * size, 3.2 * size).fill(leaves[2]);
}

function garden(art: Art, ground: Point[]) {
  const { g, b, v } = art;
  const spec = BUILDINGS[b.kind];
  const corner = iso(b.x + spec.width - 0.28, b.y + spec.height - 0.22);
  if (v.garden === 'palm' || v.garden === 'tree') tree(g, corner, 0.75, v.garden === 'palm', v.index);
  else if (v.garden === 'hedge') {
    const a = lerp(ground[3]!, ground[2]!, 0.08), z = lerp(ground[3]!, ground[2]!, 0.32);
    g.moveTo(a.x, a.y - 2).lineTo(z.x, z.y - 2).stroke({ color: 0x4f8d61, width: 4.5, cap: 'round' });
    g.moveTo(a.x, a.y - 3.5).lineTo(z.x, z.y - 3.5).stroke({ color: 0x67a273, width: 2, cap: 'round' });
  } else {
    for (const t of [0.12, 0.2, 0.28]) {
      const p = lerp(ground[3]!, ground[2]!, t);
      g.circle(p.x, p.y - 1.5, 1.8).fill(0x4f8d61).circle(p.x - 0.6, p.y - 2.6, 1).fill(t === 0.2 ? 0xe58f7a : 0xf2c14e);
    }
  }
}

function balconyRail(art: Art, a: Point, b: Point, height: number) {
  const p1 = up(lerp(a, b, 0.08), height), p2 = up(lerp(a, b, 0.92), height);
  polygon(art.g, [p1, p2, { x: p2.x, y: p2.y + 2.2 }, { x: p1.x, y: p1.y + 2.2 }], shade(art.v.wall, 0.7), 0.9);
  art.g.moveTo(p1.x, p1.y - 3).lineTo(p2.x, p2.y - 3).stroke({ color: art.v.trim, width: 1, alpha: 0.95 });
  for (let i = 0; i <= 6; i += 1) {
    const p = lerp(p1, p2, i / 6);
    art.g.moveTo(p.x, p.y).lineTo(p.x, p.y - 3).stroke({ color: art.v.trim, width: 0.6, alpha: 0.8 });
  }
}

function drawHouse(art: Art, progress: number, floors: number, windowsPerTile: number) {
  const { g, b, v } = art;
  const spec = BUILDINGS[b.kind];
  const ground = footprint(b.x, b.y, spec.width, spec.height);
  const total = buildingLift(b, progress);
  const roofRise = Math.min(16, total * 0.42);
  const wallHeight = progress < 0.62 ? total : total - roofRise * 0.55;
  dropShadow(g, ground, total);
  drawMass(g, ground, wallHeight, v.wall, shade(v.wall, 0.9));
  const floorHeight = Math.max(6, (wallHeight - 3) / floors);
  windowsOnWall(art, ground[3]!, ground[2]!, Math.max(1, Math.round(spec.width * windowsPerTile)), floors, 3.5, floorHeight, 0x9fc9c6, b.kind === 'townhouse');
  windowsOnWall(art, ground[2]!, ground[1]!, Math.max(1, Math.round(spec.height * windowsPerTile)), floors, 3.5, floorHeight, 0x86b2b2, b.kind === 'townhouse');
  if (progress < 0.62) return;
  if (floors > 1 && v.balconies) {
    balconyRail(art, ground[3]!, ground[2]!, 3.5 + floorHeight * 0.98);
    if (b.kind === 'townhouse') balconyRail(art, ground[2]!, ground[1]!, 3.5 + floorHeight * 1.98);
  }
  if (b.kind === 'duplex') {
    // Party wall splits the two homes; each half gets its own door.
    const mid = lerp(ground[3]!, ground[2]!, 0.5);
    g.moveTo(mid.x, mid.y).lineTo(mid.x, mid.y - wallHeight).stroke({ color: shade(v.wall, 0.65), width: 1.2, alpha: 0.7 });
  }
  doorway(art, ground, Math.min(11, floorHeight * 0.9), v.index % 2 === 0);
  pitchedRoof(art, wallHeight, roofRise, v.roof);
  garden(art, ground);
}

function drawTower(art: Art, progress: number, floors: number, columns: number, residential: boolean) {
  const { g, b, v } = art;
  const spec = BUILDINGS[b.kind];
  const ground = footprint(b.x, b.y, spec.width, spec.height);
  const height = buildingLift(b, progress);
  const glass = residential ? v.glass : shade(v.glass, 0.85);
  dropShadow(g, ground, height);
  const wall = residential ? v.wall : 0xc9d6d8;
  const top = drawMass(g, ground, height, wall, residential ? shade(v.wall, 0.88) : 0xaebfc3, v.trim);
  const built = Math.max(1, Math.round(floors * Math.min(1, progress + 0.1)));
  const floorHeight = (height - 7) / Math.max(1, built);
  for (const [a, z, tint] of [[ground[3]!, ground[2]!, glass], [ground[2]!, ground[1]!, shade(glass, 0.82)]] as const) {
    for (let floor = 0; floor < built; floor += 1) {
      const v1 = 5 + floor * floorHeight, v2 = v1 + floorHeight * (residential ? 0.55 : 0.68);
      if (residential) {
        for (let column = 0; column < columns; column += 1) {
          window(art, wallQuad(a, z, 0.08 + 0.84 * column / columns + 0.03, 0.08 + 0.84 * (column + 1) / columns - 0.03, v1, v2), tint);
        }
        if (v.balconies && floor % 2 === 1) balconyRail(art, a, z, v1 - 0.5);
      } else {
        // Curtain wall: continuous glazing with mullions; each bay can glow at night.
        polygon(g, wallQuad(a, z, 0.05, 0.95, v1, v2), tint, 0.96);
        for (let column = 0; column < columns; column += 1) {
          const bay = wallQuad(a, z, 0.05 + 0.9 * column / columns, 0.05 + 0.9 * (column + 1) / columns, v1, v2);
          if (art.lights && windowLit(v, art.windowIndex)) art.lights.push(bay);
          art.windowIndex += 1;
          if (column > 0) {
            const p1 = up(lerp(a, z, 0.05 + 0.9 * column / columns), v1), p2 = up(lerp(a, z, 0.05 + 0.9 * column / columns), v2);
            g.moveTo(p1.x, p1.y).lineTo(p2.x, p2.y).stroke({ color: shade(wall, 1.08), width: 0.9, alpha: 0.9 });
          }
        }
        const sheen = wallQuad(a, z, 0.05, 0.3, v1, v2);
        polygon(g, sheen, 0xffffff, 0.12);
      }
    }
  }
  if (progress < 0.9) return;
  // Lobby canopy over the entrance.
  const { a, b: z } = entranceFace(art, ground);
  polygon(g, wallQuad(a, z, 0.38, 0.62, 0, 6), shade(glass, 0.6), 1);
  polygon(g, wallQuad(a, z, 0.33, 0.67, 6.5, 8.5), residential ? v.awning : 0x2f4a3a, 1);
  const center = { x: (top[0]!.x + top[2]!.x) / 2, y: (top[0]!.y + top[2]!.y) / 2 };
  const inset = top.map((p) => lerp(p, center, 0.42));
  polygon(g, inset, shade(residential ? v.wall : 0xaebfc3, 0.82), 1);
  if (residential) {
    // Roof garden or water tank, per variant.
    if (v.index % 2 === 0) {
      g.circle(center.x - 8, center.y + 1, 3.4).fill(0x5f9a62).circle(center.x + 6, center.y - 1, 2.8).fill(0x4f8d61).circle(center.x, center.y + 4, 2.2).fill(0x7aae6c);
    } else {
      g.roundRect(center.x - 4, center.y - 9, 8, 9, 2).fill(0xb9a58a).ellipse(center.x, center.y - 9, 4, 1.6).fill(0xd2c0a4);
    }
  } else {
    polygon(g, [center, { x: center.x + 9, y: center.y + 4.5 }, { x: center.x + 9, y: center.y - 2 }, { x: center.x, y: center.y - 6.5 }], 0xb9c4c2, 1);
    g.moveTo(center.x - 6, center.y).lineTo(center.x - 6, center.y - 16).stroke({ color: 0x8a9799, width: 1.2 });
    g.circle(center.x - 6, center.y - 16, 1.4).fill(0xe36f73);
  }
}

function drawPark(art: Art) {
  const { g, b, v } = art;
  const spec = BUILDINGS.park;
  const ground = footprint(b.x, b.y, spec.width, spec.height);
  const upper = ground.map((point) => up(point, 4));
  polygon(g, [ground[3]!, ground[2]!, upper[2]!, upper[3]!], 0x6e8f5f);
  polygon(g, [ground[2]!, ground[1]!, upper[1]!, upper[2]!], 0x5d7f51);
  polygon(g, upper, 0x8dbb76, 1, 0x5f8a58, 0.45);
  const P = (dx: number, dy: number) => up(iso(b.x + dx, b.y + dy), 4);
  const path = { color: 0xe8d9b0, cap: 'round' as const };
  if (v.parkLayout === 'cross') {
    g.moveTo(P(0.1, 2).x, P(0.1, 2).y).lineTo(P(3.9, 2).x, P(3.9, 2).y).stroke({ ...path, width: 4 });
    g.moveTo(P(2, 0.1).x, P(2, 0.1).y).lineTo(P(2, 3.9).x, P(2, 3.9).y).stroke({ ...path, width: 4 });
  } else if (v.parkLayout === 'curve') {
    g.moveTo(P(0, 2.2).x, P(0, 2.2).y).quadraticCurveTo(P(2, 1.4).x, P(2, 1.4).y, P(4, 2.4).x, P(4, 2.4).y).stroke({ ...path, width: 4.2 });
    g.moveTo(P(2, 0).x, P(2, 0).y).quadraticCurveTo(P(2.4, 2).x, P(2.4, 2).y, P(1.8, 4).x, P(1.8, 4).y).stroke({ ...path, width: 3.4 });
  } else {
    const c = P(2, 2);
    g.ellipse(c.x, c.y, 34, 17).stroke({ ...path, width: 4 });
    g.moveTo(P(0, 2).x, P(0, 2).y).lineTo(P(0.9, 2).x, P(0.9, 2).y).stroke({ ...path, width: 3.4 });
  }
  const featureAt = v.parkLayout === 'ring' ? P(2, 2) : P(2.9, 3.0);
  if (v.parkFeature === 'pond') {
    g.ellipse(featureAt.x, featureAt.y, 13, 6).fill(0x6fb6bf).ellipse(featureAt.x - 2, featureAt.y - 1, 8, 3).fill({ color: 0xd8f4ea, alpha: 0.4 });
  } else if (v.parkFeature === 'fountain') {
    g.ellipse(featureAt.x, featureAt.y, 10, 5).fill(0xd9cdb0).ellipse(featureAt.x, featureAt.y - 1, 7.5, 3.6).fill(0x6fb6bf);
    g.moveTo(featureAt.x, featureAt.y - 1).lineTo(featureAt.x, featureAt.y - 9).stroke({ color: 0xd8f4ea, width: 1.6, alpha: 0.9 });
  } else if (v.parkFeature === 'gazebo') {
    g.ellipse(featureAt.x, featureAt.y, 9, 4.5).fill(0xe8dcc4);
    for (const dx of [-6, 6]) g.moveTo(featureAt.x + dx, featureAt.y).lineTo(featureAt.x + dx, featureAt.y - 9).stroke({ color: 0xf7f2e2, width: 1.4 });
    g.poly([featureAt.x - 10, featureAt.y - 8, featureAt.x, featureAt.y - 15, featureAt.x + 10, featureAt.y - 8]).fill(0xc8714f);
  } else {
    g.ellipse(featureAt.x, featureAt.y, 11, 5.5).fill(0xe6d7a8);
    g.moveTo(featureAt.x - 6, featureAt.y).lineTo(featureAt.x - 6, featureAt.y - 9).lineTo(featureAt.x + 6, featureAt.y - 9).lineTo(featureAt.x + 6, featureAt.y)
      .stroke({ color: 0x5fa7a8, width: 1.4 });
    g.moveTo(featureAt.x - 2, featureAt.y - 9).lineTo(featureAt.x - 2, featureAt.y - 4).stroke({ color: 0x8a6a48, width: 0.8 });
    g.roundRect(featureAt.x - 3.5, featureAt.y - 4.5, 3, 1.2, 0.5).fill(0xe0c27a);
  }
  const bench = P(1.1, 1.3);
  g.roundRect(bench.x - 5, bench.y - 3, 10, 2.4, 1).fill(0x9b6f4a);
  const trees = [[0.6, 0.7, 1], [3.3, 0.8, 0.9], [0.8, 3.3, 1.05], [3.4, 1.9, 0.8], [1.4, 2.6, 0.7]] as const;
  trees.forEach(([dx, dy, size], index) => { if ((v.seed >> index) % 5 !== 0) tree(g, P(dx, dy), size, false, (v.index + index) % 3); });
  for (const [dx, dy] of [[1.6, 0.4], [2.7, 1.2], [0.4, 2.9], [3.6, 3.6]] as const) {
    const flower = P(dx, dy);
    g.circle(flower.x, flower.y, 1.4).fill(0xf2c14e).circle(flower.x + 3, flower.y + 1, 1.2).fill(0xe58f7a);
  }
}

function drawPool(art: Art) {
  const { g, b, v } = art;
  const spec = BUILDINGS.pool;
  const ground = footprint(b.x, b.y, spec.width, spec.height);
  const deck = ground.map((point) => up(point, 5));
  dropShadow(g, ground, 5);
  polygon(g, [ground[3]!, ground[2]!, deck[2]!, deck[3]!], 0xd8ccb0);
  polygon(g, [ground[2]!, ground[1]!, deck[1]!, deck[2]!], 0xc2b496);
  polygon(g, deck, 0xeee2c6, 1, 0xc9b994, 0.6);
  const P = (dx: number, dy: number) => up(iso(b.x + dx, b.y + dy), 5);
  const water = [P(0.5, 0.6), P(2.5, 0.6), P(2.5, 3.1), P(0.5, 3.1)];
  polygon(g, water, 0x4fb3c2, 1, 0xf7f2e2, 0.95);
  polygon(g, [P(0.5, 0.6), P(2.5, 0.6), P(2.5, 1.1), P(0.5, 1.1)], 0x3d9fb0, 0.6);
  const center = P(1.5, 1.85);
  g.moveTo(center.x - 20, center.y - 2).quadraticCurveTo(center.x, center.y - 7, center.x + 20, center.y - 1).stroke({ color: 0xd8f4ea, width: 1.6, alpha: 0.8 });
  g.moveTo(center.x - 16, center.y + 6).quadraticCurveTo(center.x, center.y + 2, center.x + 16, center.y + 7).stroke({ color: 0xd8f4ea, width: 1.2, alpha: 0.7 });
  for (const dy of [0.9, 1.9, 2.9]) {
    const lounger = P(2.78, dy);
    g.roundRect(lounger.x - 5, lounger.y - 2, 10, 3, 1.2).fill(0xf7f2e2).roundRect(lounger.x - 5, lounger.y - 2, 3.6, 3, 1).fill(v.awning);
  }
  const umbrella = P(2.8, 3.6);
  g.moveTo(umbrella.x, umbrella.y).lineTo(umbrella.x, umbrella.y - 14).stroke({ color: 0x8a6a48, width: 1.2 });
  g.poly([umbrella.x - 9, umbrella.y - 12, umbrella.x, umbrella.y - 18, umbrella.x + 9, umbrella.y - 12]).fill(v.awning);
  g.poly([umbrella.x - 9, umbrella.y - 12, umbrella.x, umbrella.y - 18, umbrella.x - 3, umbrella.y - 12]).fill({ color: 0xffffff, alpha: 0.35 });
  tree(g, P(0.25, 3.7), 0.7, true, v.index);
}

function drawClubhouse(art: Art) {
  const { g, b, v } = art;
  const spec = BUILDINGS.clubhouse;
  const ground = footprint(b.x, b.y, spec.width, spec.height);
  const wallHeight = 26;
  dropShadow(g, ground, 34);
  const top = drawMass(g, ground, wallHeight, 0xeedcbc, 0xd9c7a2);
  windowsOnWall(art, ground[3]!, ground[2]!, 3, 1, 6, 16, 0x9fc9c6, true);
  windowsOnWall(art, ground[2]!, ground[1]!, 2, 1, 6, 16, 0x86b2b2, true);
  doorway(art, ground, 13, false);
  const roof = ground.map((point) => up(point, 40));
  for (let index = 0; index <= 6; index += 1) {
    const a = lerp(roof[3]!, roof[0]!, index / 6), z = lerp(roof[2]!, roof[1]!, index / 6);
    g.moveTo(a.x, a.y).lineTo(z.x, z.y).stroke({ color: v.roof, width: 2.2, alpha: 0.95 });
  }
  g.moveTo(roof[3]!.x, roof[3]!.y).lineTo(roof[2]!.x, roof[2]!.y).lineTo(roof[1]!.x, roof[1]!.y).stroke({ color: shade(v.roof, 0.75), width: 2.4 });
  for (const corner of [roof[3]!, roof[2]!, roof[1]!]) {
    g.moveTo(corner.x, corner.y + 40 - wallHeight).lineTo(corner.x, corner.y).stroke({ color: 0xf6f0e2, width: 1.6 });
  }
  // Climbing vines on the pergola.
  for (const t of [0.2, 0.55, 0.85]) {
    const p = lerp(roof[3]!, roof[2]!, t);
    g.circle(p.x, p.y + 1, 3).fill({ color: 0x5f9a62, alpha: 0.9 }).circle(p.x + 2, p.y + 3, 1.2).fill(0xe58f7a);
  }
  const sign = lerp(top[3]!, top[2]!, 0.5);
  g.roundRect(sign.x - 13, sign.y + 3, 26, 5, 2).fill(0x2f4a3a);
  g.roundRect(sign.x - 10, sign.y + 4.5, 20, 2, 1).fill(0xf2c14e);
  tree(g, iso(b.x + 0.3, b.y + spec.height - 0.3), 0.85, true, v.index);
}

function drawMall(art: Art, progress: number) {
  const { g, b, v } = art;
  const spec = BUILDINGS.mall;
  const ground = footprint(b.x, b.y, spec.width, spec.height);
  const height = buildingLift(b, progress);
  dropShadow(g, ground, height);
  const top = drawMass(g, ground, height, 0xe9e2d2, 0xd8d4c6, 0xf7f2e2);
  for (const [a, z, color] of [[ground[3]!, ground[2]!, 0x7fb7bb], [ground[2]!, ground[1]!, 0x6ea3a8]] as const) {
    // Shopfronts with individual lit bays.
    const bays = 5;
    for (let bay = 0; bay < bays; bay += 1) {
      const quad = wallQuad(a, z, 0.05 + 0.9 * bay / bays + 0.01, 0.05 + 0.9 * (bay + 1) / bays - 0.01, 4, Math.max(8, height * 0.45));
      polygon(g, quad, color, 0.95);
      if (art.lights && windowLit(v, art.windowIndex)) art.lights.push(quad);
      art.windowIndex += 1;
    }
    // Striped awning band.
    for (let stripe = 0; stripe < 10; stripe += 1) {
      polygon(g, wallQuad(a, z, 0.05 + 0.09 * stripe, 0.05 + 0.09 * (stripe + 1), Math.max(10, height * 0.5), Math.max(13, height * 0.62)),
        stripe % 2 === 0 ? v.awning : 0xf7f2e2, 0.95);
    }
  }
  if (progress < 0.9) return;
  const sign = lerp(ground[3]!, ground[2]!, 0.5);
  g.roundRect(sign.x - 18, sign.y - height * 0.82, 36, 7, 2).fill(0x2f4a3a);
  g.roundRect(sign.x - 14, sign.y - height * 0.82 + 2.5, 28, 2, 1).fill(0xf2c14e);
  const center = { x: (top[0]!.x + top[2]!.x) / 2, y: (top[0]!.y + top[2]!.y) / 2 };
  for (const [dx, dy] of [[-22, 0], [0, -6], [18, 4]] as const) {
    g.roundRect(center.x + dx - 6, center.y + dy - 5, 12, 6, 1.5).fill(0xb9c4c2).roundRect(center.x + dx - 6, center.y + dy - 5, 12, 2, 1).fill(0xd8dedc);
  }
  for (const t of [0.15, 0.85]) tree(g, lerp(ground[3]!, ground[2]!, t), 0.6, false, v.index);
}

/** Phase 7 venues (vector fallback only; the baked art is the normal look): a lettered block with shopfront glass. */
const VENUE_FALLBACK: Partial<Record<BuildingKind, { wall: number; roof: number; sign: number; glass: number; open?: boolean }>> = {
  cafe: { wall: 0xf6ead4, roof: 0xd8d2c4, sign: 0x3f8d8a, glass: 0x9fc9c6 }, shops: { wall: 0xf3ebdc, roof: 0xc8714f, sign: 0xc8674a, glass: 0x8fbcc0 },
  market: { wall: 0xe8925f, roof: 0xf1c45f, sign: 0x7a3b2a, glass: 0xf1c45f, open: true }, cinema: { wall: 0xefe4d6, roof: 0xe6d9c8, sign: 0x8a5a6e, glass: 0xf1c45f },
  nightclub: { wall: 0x5a3f3a, roof: 0x2a2228, sign: 0xd94f8a, glass: 0x6a4a8a }, stage: { wall: 0xf6f3ec, roof: 0xece6da, sign: 0x2f4a3a, glass: 0xc8674a, open: true },
  plaza: { wall: 0xe6d9bf, roof: 0xd9cbb0, sign: 0xc8674a, glass: 0x6fb6bf, open: true }, amusement: { wall: 0xf3dcc8, roof: 0xe07d6a, sign: 0xe8504a, glass: 0x5fb0aa, open: true },
};
function drawVenue(art: Art, progress: number) {
  const { g, b } = art;
  const spec = BUILDINGS[b.kind], look = VENUE_FALLBACK[b.kind]!;
  const ground = footprint(b.x, b.y, spec.width, spec.height);
  const height = buildingLift(b, progress);
  if (look.open) {
    // Open-air venues: paved ground, a coloured feature and a sign post.
    polygon(g, ground, look.wall, 1, shade(look.wall, 0.7), 0.5);
    const center = { x: (ground[0]!.x + ground[2]!.x) / 2, y: (ground[0]!.y + ground[2]!.y) / 2 };
    g.roundRect(center.x - 14, center.y - height - 4, 28, Math.max(8, height), 3).fill(look.roof).stroke({ color: shade(look.roof, 0.6), width: 1 });
    g.roundRect(center.x - 10, center.y - height, 20, 4, 1.5).fill(look.sign);
    return;
  }
  dropShadow(g, ground, height);
  drawMass(g, ground, height, look.wall, look.roof, look.sign);
  windowsOnWall(art, ground[3]!, ground[2]!, Math.max(2, spec.width), 1, 4, Math.max(10, height * 0.45), look.glass, true);
  windowsOnWall(art, ground[2]!, ground[1]!, Math.max(1, spec.height), 1, 4, Math.max(10, height * 0.45), shade(look.glass, 0.85), true);
  const sign = lerp(ground[3]!, ground[2]!, 0.5);
  g.roundRect(sign.x - 16, sign.y - height * 0.78, 32, 6, 2).fill(look.sign);
}

export function drawBuildingArt(graphics: Graphics, building: Building, progress: number, options: ArtOptions = {}) {
  const art: Art = { g: graphics, b: building, v: options.variant ?? buildingVariant(building.id, building.kind),
    sides: options.roadSides ?? NO_ROAD_SIDES, lights: options.lights, windowIndex: 0 };
  switch (building.kind) {
    case 'villa': drawHouse(art, progress, 1, 0.9); break;
    case 'duplex': drawHouse(art, progress, 2, 0.8); break;
    case 'townhouse': drawHouse(art, progress, 3, 0.75); break;
    case 'apartment': drawTower(art, progress, 6, 4, true); break;
    case 'park': drawPark(art); break;
    case 'clubhouse': drawClubhouse(art); break;
    case 'pool': drawPool(art); break;
    case 'mall': drawMall(art, progress); break;
    case 'office': drawTower(art, progress, 8, 5, false); break;
    default: drawVenue(art, progress);
  }
}
