import type { Building, CityPlan, Position } from './types.js';

export const tileKey = (position: Position): string => `${position.x},${position.y}`;
export const compareTiles = (a: Position, b: Position): number => a.y - b.y || a.x - b.x;

export function isGridPosition(value: Position): boolean {
  return value !== null && typeof value === 'object' && Number.isSafeInteger(value.x) && Number.isSafeInteger(value.y);
}

export function footprintTiles(building: Pick<Building, 'position' | 'footprint'>): readonly Position[] {
  validateFootprint(building);
  const tiles: Position[] = [];
  for (let y = building.position.y; y < building.position.y + building.footprint.height; y += 1) {
    for (let x = building.position.x; x < building.position.x + building.footprint.width; x += 1) tiles.push(Object.freeze({ x, y }));
  }
  return Object.freeze(tiles);
}

export function footprintPerimeter(building: Pick<Building, 'position' | 'footprint'>): readonly Position[] {
  validateFootprint(building);
  const tiles: Position[] = [];
  const { x, y } = building.position;
  for (let dx = 0; dx < building.footprint.width; dx += 1) {
    tiles.push({ x: x + dx, y: y - 1 }, { x: x + dx, y: y + building.footprint.height });
  }
  for (let dy = 0; dy < building.footprint.height; dy += 1) {
    tiles.push({ x: x - 1, y: y + dy }, { x: x + building.footprint.width, y: y + dy });
  }
  return Object.freeze(tiles.sort(compareTiles).map((tile) => Object.freeze(tile)));
}

function validateFootprint(building: Pick<Building, 'position' | 'footprint'>): void {
  if (!isGridPosition(building.position) || !Number.isSafeInteger(building.footprint.width) || building.footprint.width <= 0 ||
      !Number.isSafeInteger(building.footprint.height) || building.footprint.height <= 0 ||
      building.footprint.width * building.footprint.height > 1_000_000 ||
      !Number.isSafeInteger(building.position.x + building.footprint.width) ||
      !Number.isSafeInteger(building.position.y + building.footprint.height)) throw new RangeError('invalid footprint');
}

export type TileOccupant = { readonly type: 'building'; readonly buildingId: string } |
  { readonly type: 'road' } | { readonly type: 'blocked' };

/** Sparse immutable query index. Overlapping authored tiles are rejected. */
export class OccupancyGrid {
  readonly width: number;
  readonly height: number;
  #cells = new Map<string, TileOccupant>();

  constructor(plan: CityPlan) {
    if (!Number.isSafeInteger(plan.width) || !Number.isSafeInteger(plan.height) || plan.width <= 0 || plan.height <= 0 ||
        plan.width * plan.height > 1_000_000) throw new RangeError('invalid occupancy map dimensions');
    this.width = plan.width;
    this.height = plan.height;
    const insert = (position: Position, occupant: TileOccupant) => {
      if (!this.isInBounds(position)) throw new RangeError('occupancy tile is outside the plan');
      const key = tileKey(position);
      if (this.#cells.has(key)) throw new RangeError(`overlapping occupancy at ${key}`);
      this.#cells.set(key, Object.freeze(occupant));
    };
    for (const tile of plan.blockedTiles) insert(tile, { type: 'blocked' });
    for (const tile of plan.roads) insert(tile, { type: 'road' });
    for (const building of plan.buildings) {
      if (!this.isInBounds(building.position) || !Number.isSafeInteger(building.footprint.width) || building.footprint.width <= 0 ||
          !Number.isSafeInteger(building.footprint.height) || building.footprint.height <= 0 ||
          building.position.x + building.footprint.width > plan.width || building.position.y + building.footprint.height > plan.height) {
        throw new RangeError('building footprint must fit the occupancy map');
      }
      for (const tile of footprintTiles(building)) insert(tile, { type: 'building', buildingId: building.id });
    }
    Object.freeze(this);
  }

  isInBounds(position: Position): boolean {
    return isGridPosition(position) && position.x >= 0 && position.y >= 0 && position.x < this.width && position.y < this.height;
  }

  get(position: Position): TileOccupant | null {
    return this.isInBounds(position) ? this.#cells.get(tileKey(position)) ?? null : null;
  }
}
