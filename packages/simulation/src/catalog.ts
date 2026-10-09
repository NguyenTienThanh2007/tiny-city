import type { BuildingKind, BuildingType } from './types.js';

export const CONSTRUCTION_COSTS = Object.freeze({ villa: 120, park: 80, clubhouse: 220, road: 8 });

export interface BuildingDefinition {
  readonly label: string;
  readonly kind: BuildingKind;
  readonly footprint: { readonly width: number; readonly height: number };
  readonly capacity: number;
  readonly cost: number;
  readonly requiresRoad: boolean;
}

export const BUILDING_CATALOG: Readonly<Record<BuildingType, BuildingDefinition>> = Object.freeze({
  villa: Object.freeze({ label: 'Villa', kind: 'home', footprint: Object.freeze({ width: 2, height: 2 }), capacity: 2, cost: CONSTRUCTION_COSTS.villa, requiresRoad: true }),
  park: Object.freeze({ label: 'Park', kind: 'park', footprint: Object.freeze({ width: 4, height: 4 }), capacity: 20, cost: CONSTRUCTION_COSTS.park, requiresRoad: false }),
  clubhouse: Object.freeze({ label: 'Clubhouse', kind: 'workplace', footprint: Object.freeze({ width: 3, height: 3 }), capacity: 20, cost: CONSTRUCTION_COSTS.clubhouse, requiresRoad: true }),
});

export function isBuildingType(value: unknown): value is BuildingType {
  return typeof value === 'string' && Object.hasOwn(BUILDING_CATALOG, value);
}
