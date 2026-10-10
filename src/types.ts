import { BUILDING_CATALOG } from '@tiny-city/simulation';
import type { BuildingType } from '@tiny-city/simulation';

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
