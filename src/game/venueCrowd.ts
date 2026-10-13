import type { Building, Citizen, Position, WorldState } from '@tiny-city/simulation';
import { buildingDepth } from './npcMotion';

/**
 * Where real visitors stand inside open-air venues. The simulation keeps a leisure visitor "inside" a park, pool or
 * clubhouse (status 'inside', currentBuildingId = the venue); 2.0–3.0B hid them, which made busy parks look empty.
 * This presentation layer shows each actual visitor at a deterministic spot on the lawn, deck or terrace with a
 * fitting pose. It reads WorldState only, never writes it, and never invents residents: one figure per real visitor,
 * up to the venue's visible slots (extra visitors stay inside, as before).
 *
 * Extensible: future venues (café, shopping street, concert stage, night market, cinema …) add a `VenueProfile`
 * with their own slots and actions; the renderer needs no other change.
 */

export type CrowdAction = 'idle' | 'talk' | 'sit';
export interface CrowdSlot { readonly x: number; readonly y: number; readonly action: CrowdAction; /** Index of the partner slot for conversations. */ readonly partner?: number }
export interface VenueProfile {
  /** Footprint the slot coordinates were authored for (built facing south; east-facing art swaps axes). */
  readonly width: number;
  readonly height: number;
  readonly slots: readonly CrowdSlot[];
  /** Where the player stands while visiting (never on the centrepiece). */
  readonly player: { readonly x: number; readonly y: number };
}

/**
 * Slots avoid baked trees, shrubs, water and flowerbeds of the 3.0B venue art (scripts/art/assets). Any slot behind
 * the venue centre (x + y < 4.2) keeps a screen-lateral offset |x − y| ≥ 1.2 so it never overlaps a centrepiece.
 */
export const VENUE_PROFILES: Readonly<Record<string, VenueProfile>> = {
  // Park spots sit on the front lawn or well to the sides: anything just behind the centrepiece (fountain, pond,
  // pavilion) would overlap its silhouette on screen, and the venue sprite (lawn included) can't be drawn over them.
  park: { width: 4, height: 4, slots: [
    { x: 1.0, y: 2.95, action: 'talk', partner: 1 }, { x: 1.3, y: 3.1, action: 'talk', partner: 0 },
    { x: 1.85, y: 3.15, action: 'talk', partner: 3 }, { x: 2.15, y: 3.25, action: 'talk', partner: 2 },
    { x: 3.25, y: 2.45, action: 'sit' }, { x: 2.45, y: 2.95, action: 'idle' },
    { x: 2.95, y: 1.05, action: 'talk', partner: 7 }, { x: 3.2, y: 1.2, action: 'talk', partner: 6 },
    { x: 0.7, y: 2.3, action: 'sit' }, { x: 3.45, y: 2.05, action: 'idle' },
    { x: 2.75, y: 3.35, action: 'idle' }, { x: 1.25, y: 3.45, action: 'sit' },
  ], player: { x: 2.45, y: 3.6 } },
  pool: { width: 3, height: 4, slots: [
    { x: 0.36, y: 2.68, action: 'sit' }, { x: 0.8, y: 2.68, action: 'sit' }, { x: 1.24, y: 2.68, action: 'sit' }, { x: 1.68, y: 2.68, action: 'sit' },
    { x: 1.0, y: 3.25, action: 'talk', partner: 5 }, { x: 1.3, y: 3.35, action: 'talk', partner: 4 },
    { x: 2.62, y: 2.55, action: 'idle' }, { x: 2.75, y: 2.25, action: 'idle' },
    { x: 2.1, y: 3.3, action: 'idle' }, { x: 0.55, y: 3.3, action: 'idle' },
  ], player: { x: 1.7, y: 3.25 } },
  clubhouse: { width: 3, height: 3, slots: [
    { x: 0.6, y: 2.15, action: 'talk', partner: 1 }, { x: 0.82, y: 2.22, action: 'talk', partner: 0 },
    { x: 1.25, y: 2.12, action: 'idle' }, { x: 1.75, y: 2.22, action: 'sit' },
    { x: 2.05, y: 2.2, action: 'talk', partner: 5 }, { x: 2.33, y: 2.14, action: 'talk', partner: 4 },
  ], player: { x: 1.48, y: 2.25 } },
};

export interface CrowdPlacement {
  readonly venueId: string;
  readonly position: Position;
  readonly heading: Position;
  readonly action: CrowdAction;
  /** Sort key: just above the venue's own sprite, so visitors stand on the lawn or deck instead of under it. */
  readonly depth: number;
}

/** Visitors of open-air venues and where to draw them. `frontOf` says whether a venue's art faces south or east. */
export function crowdLayout(world: WorldState, frontOf: (building: Building) => 'S' | 'E' = () => 'S'): Map<string, CrowdPlacement> {
  const out = new Map<string, CrowdPlacement>();
  const venues = new Map<string, Building>();
  for (const building of world.plan.buildings) if (building.type && VENUE_PROFILES[building.type]) venues.set(building.id, building);
  if (!venues.size) return out;
  const visitors = new Map<string, Citizen[]>();
  for (const citizen of world.citizens) {
    const m = citizen.movement;
    if (!m || m.status !== 'inside' || citizen.activity !== 'leisure' || !m.currentBuildingId || !venues.has(m.currentBuildingId)) continue;
    visitors.set(m.currentBuildingId, [...(visitors.get(m.currentBuildingId) ?? []), citizen]);
  }
  for (const [venueId, list] of visitors) {
    const venue = venues.get(venueId)!;
    const profile = VENUE_PROFILES[venue.type!]!;
    const east = frontOf(venue) === 'E';
    const depth = buildingDepth(venue.position.x, venue.position.y, venue.footprint.width, venue.footprint.height) + 0.002;
    const sorted = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const local = (slot: CrowdSlot) => (east ? { x: slot.y, y: slot.x } : { x: slot.x, y: slot.y });
    const center = east ? { x: profile.height / 2, y: profile.width / 2 } : { x: profile.width / 2, y: profile.height / 2 };
    sorted.slice(0, profile.slots.length).forEach((citizen, index) => {
      const slot = profile.slots[index]!;
      const at = local(slot);
      // A conversation only happens if the partner slot is actually filled by another real visitor.
      const partner = slot.partner !== undefined && slot.partner < sorted.length ? local(profile.slots[slot.partner]!) : null;
      const action: CrowdAction = slot.action === 'talk' && !partner ? 'idle' : slot.action;
      const look = partner ?? center;
      const heading = { x: Math.sign(Math.round((look.x - at.x) * 10)), y: Math.sign(Math.round((look.y - at.y) * 10)) };
      out.set(citizen.id, { venueId, action, depth, heading: heading.x === 0 && heading.y === 0 ? { x: 1, y: 0 } : heading,
        position: { x: venue.position.x + at.x, y: venue.position.y + at.y } });
    });
  }
  return out;
}

/** Where the player stands inside an open-air venue, or null for other buildings. */
export function playerVenueSpot(venue: Building, frontOf: (building: Building) => 'S' | 'E' = () => 'S'): { position: Position; depth: number } | null {
  const profile = venue.type ? VENUE_PROFILES[venue.type] : undefined;
  if (!profile) return null;
  const at = frontOf(venue) === 'E' ? { x: profile.player.y, y: profile.player.x } : profile.player;
  return { position: { x: venue.position.x + at.x, y: venue.position.y + at.y },
    depth: buildingDepth(venue.position.x, venue.position.y, venue.footprint.width, venue.footprint.height) + 0.0025 };
}
