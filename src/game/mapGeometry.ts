import { BUILDINGS, type Cell, type CityState } from '../types';

export type Point = { x: number; y: number };
export const TILE_W = 56;
export const TILE_H = 28;
export const MIN_SCALE = 0.08;
export const MAX_SCALE = 1.55;
const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;
const MAP_OFFSET_X = 32 * TILE_W;

export const iso = (x: number, y: number): Point => ({
  x: MAP_OFFSET_X + (x - y) * HALF_W, y: (x + y) * HALF_H,
});

export function toGrid(point: Point): Point {
  const a = (point.x - MAP_OFFSET_X) / HALF_W;
  const b = point.y / HALF_H;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

export function toCell(point: Point): Cell {
  const grid = toGrid(point);
  // Matrix inversion can put an exact tile edge a few ulps below its integer.
  const tile = (value: number) => Math.floor(Math.abs(value - Math.round(value)) < 1e-10 ? Math.round(value) : value);
  return { x: tile(grid.x), y: tile(grid.y) };
}

export function footprint(x: number, y: number, width: number, height: number): Point[] {
  return [iso(x, y), iso(x + width, y), iso(x + width, y + height), iso(x, y + height)];
}

/** The initial/home view follows the actual saved neighborhood. */
export function cityView(city: CityState, width: number, height: number): { center: Point; scale: number } {
  const points = [...city.roads.flatMap(({ x, y }) => footprint(x, y, 1, 1)),
    ...city.buildings.flatMap((building) => {
      const spec = BUILDINGS[building.kind];
      return footprint(building.x, building.y, spec.width, spec.height);
    })];
  if (!points.length) return { center: iso(city.size / 2, city.size / 2), scale: 0.86 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs), right = Math.max(...xs);
  const top = Math.min(...ys) - 100, bottom = Math.max(...ys);
  return { center: { x: (left + right) / 2, y: (top + bottom) / 2 },
    scale: Math.max(MIN_SCALE, Math.min(0.86, Math.max(100, width - 120) / (right - left),
      Math.max(100, height - 230) / (bottom - top))) };
}

/** Fill skipped pointer samples with an orthogonally connected tile stroke. */
export function tileStroke(from: Cell, to: Cell, size: number): Cell[] {
  const inside = (cell: Cell) => cell.x >= 0 && cell.y >= 0 && cell.x < size && cell.y < size;
  if (!inside(from) || !inside(to)) return [to];
  const cells: Cell[] = [];
  let { x, y } = from;
  const dx = Math.abs(to.x - x), dy = Math.abs(to.y - y);
  let ix = 0, iy = 0;
  while (ix < dx || iy < dy) {
    if (ix < dx && (iy === dy || (ix + 0.5) / dx <= (iy + 0.5) / dy)) {
      x += Math.sign(to.x - from.x); ix += 1;
    } else { y += Math.sign(to.y - from.y); iy += 1; }
    cells.push({ x, y });
  }
  return cells;
}
