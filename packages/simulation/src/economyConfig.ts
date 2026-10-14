/**
 * Phase 5 economic balance. Every amount is whole dollars per game day and every rate is an integer percent, so all
 * authoritative arithmetic is integer arithmetic (see `percentOf`). Tune the economy here, never inline.
 */
export const ECONOMY = Object.freeze({
  version: 1 as const,
  /** Savings a resident brings when they move in (from outside the city); they take their savings when they leave. */
  startingSavings: 120,
  /** Daily wage per worker, paid by the employer. */
  wages: Object.freeze({ office: 26, mall: 18 }),
  /**
   * Offices sell services to clients outside the city (an abstract service economy): daily revenue per worker at full
   * client demand. Clients go elsewhere as commercial tax (passed on in prices) rises above `neutralCommercialTax`:
   * demand falls `perTaxPoint` percent per point, never below `min` percent.
   */
  officeRevenuePerWorker: 42,
  officeDemand: Object.freeze({ neutralCommercialTax: 6, perTaxPoint: 4, min: 30 }),
  /** Malls sell to residents: how much one mall worker can sell per day (the mall's service capacity). */
  mallSalesPerWorker: 40,
  /** Daily building operations a business pays to suppliers outside the city (energy, stock, cleaning). */
  businessUpkeep: Object.freeze({ office: 340, mall: 240 }),
  /** Daily rent and utilities per resident, paid to landlords and utilities outside the city (not to the treasury). */
  housingCost: Object.freeze({ villa: 10, duplex: 8, townhouse: 8, apartment: 6, other: 8 }),
  /**
   * Daily shopping (food, goods): `base` + `ofDisposable` percent of disposable income (after tax and housing)
   * + `ofSavingsGap` percent of (savings − `comfortSavings`), which is negative below the cushion (residents save up)
   * and positive above it (they spend more). Never below `minimum`, scaled by consumer confidence, and limited to what
   * the resident has. Savings therefore settle near a level set by income instead of draining or growing forever.
   */
  consumption: Object.freeze({ base: 6, ofDisposable: 50, ofSavingsGap: 5, comfortSavings: 150, minimum: 2 }),
  /** Entry fee per real visit (a resident who arrived at the venue for leisure), paid to the city. Parks are free. */
  venueFees: Object.freeze({ pool: 3, clubhouse: 4 }),
  /** Daily city upkeep: $1 for every `roadTilesPerDollar` road tiles (rounded up), and per public amenity. */
  cityUpkeep: Object.freeze({ roadTilesPerDollar: 4, park: 10, pool: 24, clubhouse: 18 }),
  /** Daily public services per resident (water, waste, safety), paid by the city. */
  publicServicesPerResident: 3,
  /** Daily support the city pays each resident without a job. */
  unemploymentSupport: 5,
  /** Integer percent rates the player can set, with their defaults. */
  taxes: Object.freeze({
    residential: Object.freeze({ default: 10, min: 0, max: 20 }),
    commercial: Object.freeze({ default: 6, min: 0, max: 20 }),
  }),
  /**
   * Consumer confidence (percent) scales spending. 100 + amenity bonus (up to `amenityBonus` at full coverage)
   * + 1 per residential tax point below `neutralResidentialTax` − `taxPenalty` per point above it
   * − `strainPenalty` after a day with unpaid city upkeep; clamped to [min, max].
   */
  confidence: Object.freeze({ min: 80, max: 110, amenityBonus: 8, neutralResidentialTax: 10, taxPenalty: 2, strainPenalty: 10 }),
  /** Amenity coverage is full when public leisure capacity reaches this percent of the population. */
  amenityCapacityPercentOfResidents: 30,
  /**
   * Share of shopping demand residents spend in the city's malls while there is capacity: `base` percent at or
   * below `neutralCommercialTax`, `perTaxPoint` lower for every point above it, never below `min`.
   */
  localShopping: Object.freeze({ base: 85, neutralCommercialTax: 6, perTaxPoint: 3, min: 40 }),
  /** A business with fewer workers than this percent of its jobs is understaffed. */
  understaffedPercent: 50,
  /** Bounded history: daily reports kept, and the most recent ledger entries kept (lifetime totals are kept separately). */
  historyDays: 28,
  ledgerEntries: 200,
});

/** Integer percent of a whole-dollar amount, rounded half up (toward +∞ at exactly .5). Exact for safe integers. */
export function percentOf(amount: number, percent: number): number {
  return Math.floor((amount * percent + 50) / 100);
}
