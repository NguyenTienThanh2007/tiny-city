import type { BuildingKind, BuildingType } from './types.js';

export const CONSTRUCTION_COSTS = Object.freeze({
  villa: 120, duplex: 180, townhouse: 160, apartment: 480, park: 80,
  clubhouse: 220, pool: 180, mall: 900, office: 640, road: 8,
});

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
  duplex: Object.freeze({ label: 'Semi-detached home', kind: 'home', footprint: Object.freeze({ width: 3, height: 2 }), capacity: 4, cost: CONSTRUCTION_COSTS.duplex, requiresRoad: true }),
  townhouse: Object.freeze({ label: 'Townhouse', kind: 'home', footprint: Object.freeze({ width: 2, height: 3 }), capacity: 4, cost: CONSTRUCTION_COSTS.townhouse, requiresRoad: true }),
  apartment: Object.freeze({ label: 'Apartment building', kind: 'home', footprint: Object.freeze({ width: 4, height: 4 }), capacity: 24, cost: CONSTRUCTION_COSTS.apartment, requiresRoad: true }),
  park: Object.freeze({ label: 'Park', kind: 'park', footprint: Object.freeze({ width: 4, height: 4 }), capacity: 20, cost: CONSTRUCTION_COSTS.park, requiresRoad: false }),
  clubhouse: Object.freeze({ label: 'Clubhouse', kind: 'workplace', footprint: Object.freeze({ width: 3, height: 3 }), capacity: 20, cost: CONSTRUCTION_COSTS.clubhouse, requiresRoad: true }),
  pool: Object.freeze({ label: 'Swimming pool', kind: 'park', footprint: Object.freeze({ width: 3, height: 4 }), capacity: 30, cost: CONSTRUCTION_COSTS.pool, requiresRoad: true }),
  mall: Object.freeze({ label: 'Shopping mall', kind: 'workplace', footprint: Object.freeze({ width: 6, height: 5 }), capacity: 100, cost: CONSTRUCTION_COSTS.mall, requiresRoad: true }),
  office: Object.freeze({ label: 'Office tower', kind: 'workplace', footprint: Object.freeze({ width: 4, height: 4 }), capacity: 60, cost: CONSTRUCTION_COSTS.office, requiresRoad: true }),
});

export function isBuildingType(value: unknown): value is BuildingType {
  return typeof value === 'string' && Object.hasOwn(BUILDING_CATALOG, value);
}
