import { BUILDING_CATALOG } from '@tiny-city/simulation';
import type { BuildingType } from '@tiny-city/simulation';
import type { BuildingDesign } from '@tiny-city/ai-architect';

export const MAP_SIZE = 64;

export type Tool = 'select' | 'road' | 'move' | 'bulldoze' | BuildingType;
export type BuildingKind = BuildingType;

export interface Cell {
  x: number;
  y: number;
}

export interface BuildingSpec {
  kind: BuildingKind;
  label: string;
  width: number;
  height: number;
  cost: number;
  tint: number;
  capacity: number;
  role: 'home' | 'workplace' | 'park';
  requiresRoad: boolean;
}

export interface Building {
  id: string;
  kind: BuildingKind;
  x: number;
  y: number;
  name: string;
  createdAt: number;
  /**
   * Visual World 3.1 architectural identity (collection + model). Cosmetic editor metadata like `createdAt`:
   * never sent to the simulation and never changes cost, capacity or footprint. Absent on buildings from older
   * saves, which keep their original look (the classic variant from the building ID).
   */
  design?: BuildingDesign;
}

export interface CityState {
  size: number;
  roads: Cell[];
  buildings: Building[];
  funds: number;
}

const buildingTints: Record<BuildingType, number> = {
  villa: 0xe9d3a3, duplex: 0xe7cda0, townhouse: 0xd9b886, apartment: 0x9db9bb,
  park: 0x74a979, clubhouse: 0xe7a66d, pool: 0x63b9c5, mall: 0x9fb7ba, office: 0x91aabd,
  cafe: 0xe9b27a, shops: 0xd9a48f, market: 0xe8925f, cinema: 0xb98a9e, nightclub: 0x7f6f9c, stage: 0xd8d2c4, plaza: 0xd9cbb0, amusement: 0xe07d6a,
};

export const BUILDINGS: Record<BuildingKind, BuildingSpec> = Object.fromEntries(
  Object.entries(BUILDING_CATALOG).map(([key, definition]) => {
    const kind = key as BuildingType;
    return [kind, { kind, label: definition.label, width: definition.footprint.width,
      height: definition.footprint.height, cost: definition.cost, tint: buildingTints[kind],
      capacity: definition.capacity, role: definition.kind, requiresRoad: definition.requiresRoad }];
  }),
) as Record<BuildingKind, BuildingSpec>;

export const cellKey = (x: number, y: number) => `${x},${y}`;

export function isLandCell(x: number, y: number, size = MAP_SIZE): boolean {
  return x >= 0 && y >= 0 && x < size && y < size && x + y < size * 2 - 8;
}

export function occupiedCells(building: Building): Cell[] {
  const spec = BUILDINGS[building.kind];
  const cells: Cell[] = [];
  for (let y = building.y; y < building.y + spec.height; y += 1) {
    for (let x = building.x; x < building.x + spec.width; x += 1) cells.push({ x, y });
  }
  return cells;
}
