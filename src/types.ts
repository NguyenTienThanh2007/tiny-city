export const MAP_SIZE = 64;

export type Tool = 'select' | 'road' | 'villa' | 'park' | 'clubhouse' | 'bulldoze';
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

export const BUILDINGS: Record<BuildingKind, BuildingSpec> = {
  villa: { kind: 'villa', label: BUILDING_CATALOG.villa.label, width: BUILDING_CATALOG.villa.footprint.width, height: BUILDING_CATALOG.villa.footprint.height, cost: BUILDING_CATALOG.villa.cost, tint: 0xe9d3a3 },
  park: { kind: 'park', label: BUILDING_CATALOG.park.label, width: BUILDING_CATALOG.park.footprint.width, height: BUILDING_CATALOG.park.footprint.height, cost: BUILDING_CATALOG.park.cost, tint: 0x74a979 },
  clubhouse: { kind: 'clubhouse', label: BUILDING_CATALOG.clubhouse.label, width: BUILDING_CATALOG.clubhouse.footprint.width, height: BUILDING_CATALOG.clubhouse.footprint.height, cost: BUILDING_CATALOG.clubhouse.cost, tint: 0xe7a66d },
};

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

import { BUILDING_CATALOG } from '@tiny-city/simulation';
import type { BuildingType } from '@tiny-city/simulation';
