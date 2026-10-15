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

/** 'cheer': an audience during a running event (drawn with the wave pose). */
export type CrowdAction = 'idle' | 'talk' | 'sit' | 'cheer';
export interface CrowdSlot { readonly x: number; readonly y: number; readonly action: CrowdAction; /** Index of the partner slot (conversations, table companions). */ readonly partner?: number }
export interface VenueProfile {
  /** Footprint the slot coordinates were authored for (built facing south; east-facing art swaps axes). */
  readonly width: number;
  readonly height: number;
  readonly slots: readonly CrowdSlot[];
  /** Where the player stands while visiting (never on the centrepiece). */
  readonly player: { readonly x: number; readonly y: number };
  /** What visitors without a partner face (a stage, shop windows, stalls); the venue centre otherwise. */
  readonly focus?: { readonly x: number; readonly y: number };
  /** Phase 7: standing visitors cheer while an event is running at the venue. */
  readonly cheers?: boolean;
}
const row = (y: number, from: number, to: number, count: number, action: CrowdAction): CrowdSlot[] =>
  Array.from({ length: count }, (_, i) => ({ x: from + (to - from) * i / Math.max(1, count - 1), y, action }));

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
  // ─── Phase 7 open-air venues (spots follow scripts/art/assets/venues.js). Cinema and music club visitors are indoors.
  // Café terrace: pairs of chairs at three tables, plus a few people chatting at the terrace edge.
  cafe: { width: 2, height: 2, slots: [
    { x: 0.33, y: 1.47, action: 'sit', partner: 1 }, { x: 0.51, y: 1.47, action: 'sit', partner: 0 },
    { x: 0.91, y: 1.6, action: 'sit', partner: 3 }, { x: 1.09, y: 1.6, action: 'sit', partner: 2 },
    { x: 1.46, y: 1.44, action: 'sit', partner: 5 }, { x: 1.64, y: 1.44, action: 'sit', partner: 4 },
    { x: 0.72, y: 1.86, action: 'talk', partner: 7 }, { x: 0.96, y: 1.9, action: 'talk', partner: 6 },
    { x: 1.4, y: 1.84, action: 'idle' }, { x: 1.78, y: 1.86, action: 'idle' },
  ], player: { x: 1.2, y: 1.9 }, focus: { x: 1, y: 0.8 } },
  // Shopping street: window shoppers along the pavement and people resting on the benches.
  shops: { width: 4, height: 2, slots: [
    { x: 0.3, y: 1.38, action: 'idle' }, { x: 1.05, y: 1.36, action: 'talk', partner: 2 }, { x: 1.28, y: 1.42, action: 'talk', partner: 1 },
    { x: 1.95, y: 1.37, action: 'idle' }, { x: 2.85, y: 1.38, action: 'talk', partner: 5 }, { x: 3.08, y: 1.44, action: 'talk', partner: 4 },
    { x: 3.55, y: 1.36, action: 'idle' }, { x: 0.5, y: 1.7, action: 'sit', partner: 8 }, { x: 0.66, y: 1.7, action: 'sit', partner: 7 },
    { x: 2.4, y: 1.7, action: 'sit', partner: 10 }, { x: 2.56, y: 1.7, action: 'sit', partner: 9 }, { x: 1.6, y: 1.78, action: 'idle' },
  ], player: { x: 1.7, y: 1.55 }, focus: { x: 2, y: 0.9 } },
  // Night market: browsing at the stalls, eating at the picnic tables, queueing at the food truck.
  market: { width: 4, height: 3, slots: [
    { x: 0.5, y: 0.58, action: 'idle' }, { x: 0.98, y: 0.62, action: 'idle' }, { x: 1.45, y: 0.58, action: 'talk', partner: 3 }, { x: 1.68, y: 0.63, action: 'talk', partner: 2 },
    { x: 2.3, y: 0.6, action: 'idle' }, { x: 2.9, y: 0.58, action: 'idle' }, { x: 3.35, y: 1.25, action: 'idle' }, { x: 3.3, y: 1.85, action: 'idle' },
    { x: 1.2, y: 1.12, action: 'sit', partner: 9 }, { x: 1.2, y: 1.38, action: 'sit', partner: 8 },
    { x: 2.0, y: 1.22, action: 'sit', partner: 11 }, { x: 2.0, y: 1.48, action: 'sit', partner: 10 },
    { x: 1.55, y: 1.72, action: 'sit', partner: 13 }, { x: 1.55, y: 1.98, action: 'sit', partner: 12 },
    { x: 0.45, y: 2.05, action: 'talk', partner: 15 }, { x: 0.72, y: 2.0, action: 'talk', partner: 14 },
  ], player: { x: 2.6, y: 2.4 }, focus: { x: 2, y: 0.3 }, cheers: true },
  // Concert stage: the audience on the lawn, facing the stage.
  stage: { width: 4, height: 4, slots: [
    ...row(1.95, 0.75, 3.25, 7, 'idle'), ...row(2.3, 0.6, 3.4, 8, 'idle'), ...row(2.65, 0.75, 3.25, 7, 'idle'),
    ...row(3.0, 0.6, 3.4, 8, 'idle'), ...row(3.35, 0.75, 3.25, 7, 'idle'),
  ], player: { x: 2.0, y: 3.65 }, focus: { x: 2, y: 0.9 }, cheers: true },
  // Performance plaza: an audience facing the little stage, benches, and conversations by the fountain.
  plaza: { width: 3, height: 3, slots: [
    { x: 0.6, y: 1.3, action: 'idle' }, { x: 1.0, y: 1.25, action: 'idle' }, { x: 1.4, y: 1.35, action: 'idle' },
    { x: 0.8, y: 1.65, action: 'idle' }, { x: 1.2, y: 1.7, action: 'idle' }, { x: 1.6, y: 1.6, action: 'idle' },
    { x: 0.33, y: 2.76, action: 'sit', partner: 7 }, { x: 0.48, y: 2.76, action: 'sit', partner: 6 },
    { x: 1.23, y: 2.76, action: 'sit', partner: 9 }, { x: 1.38, y: 2.76, action: 'sit', partner: 8 },
    { x: 2.0, y: 1.5, action: 'talk', partner: 11 }, { x: 2.25, y: 1.56, action: 'talk', partner: 10 },
    { x: 1.9, y: 2.2, action: 'talk', partner: 13 }, { x: 2.15, y: 2.3, action: 'talk', partner: 12 },
  ], player: { x: 1.6, y: 2.4 }, focus: { x: 0.75, y: 0.55 }, cheers: true },
  // Amusement park: queues at the Ferris wheel and carousel, snacks at the tables, strolls along the paths.
  amusement: { width: 6, height: 5, slots: [
    { x: 1.0, y: 1.8, action: 'idle' }, { x: 1.25, y: 1.78, action: 'talk', partner: 2 }, { x: 1.5, y: 1.84, action: 'talk', partner: 1 },
    { x: 3.95, y: 1.85, action: 'idle' }, { x: 4.35, y: 1.9, action: 'talk', partner: 5 }, { x: 4.6, y: 1.86, action: 'talk', partner: 4 },
    { x: 0.5, y: 2.75, action: 'idle' }, { x: 1.1, y: 2.75, action: 'talk', partner: 8 }, { x: 1.32, y: 2.82, action: 'talk', partner: 7 },
    { x: 1.8, y: 3.0, action: 'sit', partner: 10 }, { x: 2.02, y: 2.88, action: 'sit', partner: 9 },
    { x: 2.36, y: 3.15, action: 'sit', partner: 12 }, { x: 2.58, y: 3.03, action: 'sit', partner: 11 },
    { x: 3.0, y: 2.6, action: 'talk', partner: 14 }, { x: 3.2, y: 2.7, action: 'talk', partner: 13 },
    { x: 3.0, y: 3.3, action: 'idle' }, { x: 3.6, y: 4.6, action: 'idle' }, { x: 2.3, y: 4.62, action: 'talk', partner: 18 }, { x: 2.52, y: 4.7, action: 'talk', partner: 17 },
  ], player: { x: 3.0, y: 4.0 }, focus: { x: 3, y: 1.5 } },
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
  // Phase 7: people out together (one outing) take neighbouring spots, so friends sit at one table or talk together.
  const outingOf = (id: string) => world.society?.residents[id]?.outing?.id ?? '';
  const running = new Set((world.society?.events ?? []).filter((e) => e.status === 'running').map((e) => e.venueId));
  for (const [venueId, list] of visitors) {
    const venue = venues.get(venueId)!;
    const profile = VENUE_PROFILES[venue.type!]!;
    const east = frontOf(venue) === 'E';
    const depth = buildingDepth(venue.position.x, venue.position.y, venue.footprint.width, venue.footprint.height) + 0.002;
    const sorted = [...list].sort((a, b) => {
      const oa = outingOf(a.id), ob = outingOf(b.id);
      return oa !== ob ? (oa === '' ? 1 : ob === '' ? -1 : oa < ob ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const local = (slot: { x: number; y: number }) => (east ? { x: slot.y, y: slot.x } : { x: slot.x, y: slot.y });
    const center = profile.focus ? local(profile.focus) : east ? { x: profile.height / 2, y: profile.width / 2 } : { x: profile.width / 2, y: profile.height / 2 };
    const cheering = profile.cheers === true && running.has(venueId);
    sorted.slice(0, profile.slots.length).forEach((citizen, index) => {
      const slot = profile.slots[index]!;
      const at = local(slot);
      // A conversation only happens if the partner slot is actually filled by another real visitor.
      const partner = slot.partner !== undefined && slot.partner < sorted.length ? local(profile.slots[slot.partner]!) : null;
      const action: CrowdAction = slot.action === 'talk' && !partner ? 'idle' : slot.action === 'idle' && cheering ? 'cheer' : slot.action;
      const look = partner && action !== 'cheer' ? partner : center;
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
