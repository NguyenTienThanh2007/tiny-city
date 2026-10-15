import type { Building, BuildingKind, BuildingType } from './types.js';

export const CONSTRUCTION_COSTS = Object.freeze({
  villa: 120, duplex: 180, townhouse: 160, apartment: 480, park: 80,
  clubhouse: 220, pool: 180, mall: 900, office: 640, road: 8,
  // Phase 7 entertainment venues.
  cafe: 260, shops: 520, market: 300, cinema: 700, nightclub: 420, stage: 600, plaza: 240, amusement: 1400,
});

export interface BuildingDefinition {
  readonly label: string;
  readonly kind: BuildingKind;
  readonly footprint: { readonly width: number; readonly height: number };
  /** Residents for homes, jobs for workplaces, visitors for parks and other public venues. */
  readonly capacity: number;
  readonly cost: number;
  readonly requiresRoad: boolean;
}

const def = (label: string, kind: BuildingKind, width: number, height: number, capacity: number, cost: number, requiresRoad = true): BuildingDefinition =>
  Object.freeze({ label, kind, footprint: Object.freeze({ width, height }), capacity, cost, requiresRoad });

export const BUILDING_CATALOG: Readonly<Record<BuildingType, BuildingDefinition>> = Object.freeze({
  villa: def('Villa', 'home', 2, 2, 2, CONSTRUCTION_COSTS.villa),
  duplex: def('Semi-detached home', 'home', 3, 2, 4, CONSTRUCTION_COSTS.duplex),
  townhouse: def('Townhouse', 'home', 2, 3, 4, CONSTRUCTION_COSTS.townhouse),
  apartment: def('Apartment building', 'home', 4, 4, 24, CONSTRUCTION_COSTS.apartment),
  park: def('Park', 'park', 4, 4, 20, CONSTRUCTION_COSTS.park, false),
  clubhouse: def('Clubhouse', 'workplace', 3, 3, 20, CONSTRUCTION_COSTS.clubhouse),
  pool: def('Swimming pool', 'park', 3, 4, 30, CONSTRUCTION_COSTS.pool),
  mall: def('Shopping mall', 'workplace', 6, 5, 100, CONSTRUCTION_COSTS.mall),
  office: def('Office tower', 'workplace', 4, 4, 60, CONSTRUCTION_COSTS.office),
  // Phase 7: businesses employ residents (capacity = jobs; visitor capacity lives in `VENUES`), the stage and the
  // plaza are public venues run by the city (capacity = visitors).
  cafe: def('Café & restaurant', 'workplace', 2, 2, 4, CONSTRUCTION_COSTS.cafe),
  shops: def('Shopping street', 'workplace', 4, 2, 8, CONSTRUCTION_COSTS.shops),
  market: def('Night market', 'workplace', 4, 3, 6, CONSTRUCTION_COSTS.market),
  cinema: def('Cinema', 'workplace', 3, 3, 6, CONSTRUCTION_COSTS.cinema),
  nightclub: def('Music club', 'workplace', 3, 2, 5, CONSTRUCTION_COSTS.nightclub),
  stage: def('Concert stage', 'park', 4, 4, 80, CONSTRUCTION_COSTS.stage),
  plaza: def('Performance plaza', 'park', 3, 3, 40, CONSTRUCTION_COSTS.plaza),
  amusement: def('Amusement park', 'workplace', 6, 5, 12, CONSTRUCTION_COSTS.amusement),
});

export function isBuildingType(value: unknown): value is BuildingType {
  return typeof value === 'string' && Object.hasOwn(BUILDING_CATALOG, value);
}

/** Phase 7 venues where residents spend money with a local business (the business employs residents). */
export const BUSINESS_VENUES = Object.freeze(['cafe', 'shops', 'market', 'cinema', 'nightclub', 'amusement'] as const);
export type BusinessVenueType = typeof BUSINESS_VENUES[number];
export const isBusinessVenue = (type: BuildingType | undefined): type is BusinessVenueType =>
  type !== undefined && (BUSINESS_VENUES as readonly string[]).includes(type);

/**
 * Visitor capacity of a leisure venue. Public venues (parks, pools, the clubhouse, the stage and the plaza) use the
 * building capacity; business venues keep jobs in `capacity` and their visitor capacity here.
 */
export const VENUE_VISITORS: Readonly<Partial<Record<BuildingType, number>>> = Object.freeze({
  cafe: 16, shops: 30, market: 40, cinema: 40, nightclub: 30, amusement: 60,
});
export function visitorCapacity(building: Building): number {
  return (building.type !== undefined ? VENUE_VISITORS[building.type] : undefined) ?? building.capacity;
}
