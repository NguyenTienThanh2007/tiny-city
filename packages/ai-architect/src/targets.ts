import { isBuildingType } from '@tiny-city/simulation';
import type { Building, WorldState } from '@tiny-city/simulation';
import type { TargetCandidate, TargetRelative, TargetSelector } from './contracts.js';

/** Result of matching a selector against the live city: exact buildings, a required choice, or a clear error. */
export type TargetResolution =
  | { readonly kind: 'resolved'; readonly ids: readonly string[] }
  | { readonly kind: 'choose'; readonly quantity: number; readonly candidates: readonly TargetCandidate[] }
  | { readonly kind: 'error'; readonly code: 'TARGET_NOT_FOUND' | 'TARGET_COUNT' | 'TARGET_UNSPECIFIED'; readonly message: string };

const LABELS: Record<string, string> = {
  villa: 'villa', duplex: 'semi-detached home', townhouse: 'townhouse', apartment: 'apartment building', park: 'park',
  clubhouse: 'clubhouse', pool: 'swimming pool', mall: 'shopping mall', office: 'office tower',
};
export const targetLabel = (selector: TargetSelector, plural = false): string => {
  const base = selector.buildingType ? LABELS[selector.buildingType] ?? selector.buildingType : 'building';
  return plural ? `${base}${base.endsWith('s') ? 'es' : 's'}` : base;
};

export const candidateOf = (b: Building): TargetCandidate =>
  ({ buildingId: b.id, name: b.name, buildingType: b.type ?? null, position: { x: b.position.x, y: b.position.y } });

/** Isometric screen axes from a footprint centre: x − y runs left→right, x + y runs back→front. */
function screenKey(b: Building, relative: TargetRelative): number {
  const cx = b.position.x + b.footprint.width / 2, cy = b.position.y + b.footprint.height / 2;
  switch (relative) {
    case 'left': return cx - cy;
    case 'right': return -(cx - cy);
    case 'back': return cx + cy;
    case 'front': return -(cx + cy);
  }
}

export function validSelector(value: unknown): value is TargetSelector {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as Record<string, unknown>;
  return Object.keys(s).every((k) => ['buildingType', 'ids', 'quantity', 'all', 'relative'].includes(k)) &&
    (s.buildingType === null || isBuildingType(s.buildingType)) &&
    Array.isArray(s.ids) && s.ids.length <= 32 && s.ids.every((id) => typeof id === 'string' && id.trim().length > 0 && id.length <= 128) &&
    typeof s.quantity === 'number' && Number.isSafeInteger(s.quantity) && s.quantity >= 1 && s.quantity <= 32 &&
    typeof s.all === 'boolean' && (s.relative === null || ['left', 'right', 'back', 'front'].includes(String(s.relative)));
}

/** Deterministic: identical worlds and selectors always resolve identically. Never picks an arbitrary match. */
export function resolveTarget(world: WorldState, selector: TargetSelector): TargetResolution {
  const byId = new Map(world.plan.buildings.map((b) => [b.id, b]));
  if (selector.ids.length) {
    const missing = selector.ids.filter((id) => !byId.has(id));
    if (missing.length) return { kind: 'error', code: 'TARGET_NOT_FOUND', message: `Building ${missing.join(', ')} does not exist in this city.` };
    const wrongType = selector.buildingType ? selector.ids.filter((id) => byId.get(id)!.type !== selector.buildingType) : [];
    if (wrongType.length) return { kind: 'error', code: 'TARGET_NOT_FOUND', message: `Building ${wrongType.join(', ')} is not a ${targetLabel(selector)}.` };
    return { kind: 'resolved', ids: [...new Set(selector.ids)] };
  }
  if (!selector.buildingType) return { kind: 'error', code: 'TARGET_UNSPECIFIED', message: 'Say which building type or building to change.' };
  const matches = world.plan.buildings.filter((b) => b.type === selector.buildingType).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!matches.length) return { kind: 'error', code: 'TARGET_NOT_FOUND', message: `There is no ${targetLabel(selector)} in this city.` };
  if (selector.all) return { kind: 'resolved', ids: matches.map((b) => b.id) };
  if (matches.length < selector.quantity) {
    return { kind: 'error', code: 'TARGET_COUNT', message: `You asked for ${selector.quantity} ${targetLabel(selector, selector.quantity > 1)}, but the city has ${matches.length}.` };
  }
  if (selector.relative) {
    const relative = selector.relative;
    const sorted = [...matches].sort((a, b) => screenKey(a, relative) - screenKey(b, relative) || (a.id < b.id ? -1 : 1));
    // A tie at the cut-off means "the leftmost" is not well defined: ask instead of guessing.
    const cut = sorted[selector.quantity - 1]!, next = sorted[selector.quantity];
    if (next && Math.abs(screenKey(next, relative) - screenKey(cut, relative)) < 1e-9) {
      const tied = sorted.filter((b) => Math.abs(screenKey(b, relative) - screenKey(cut, relative)) < 1e-9 || screenKey(b, relative) < screenKey(cut, relative));
      return { kind: 'choose', quantity: selector.quantity, candidates: tied.map(candidateOf) };
    }
    return { kind: 'resolved', ids: sorted.slice(0, selector.quantity).map((b) => b.id) };
  }
  if (matches.length === selector.quantity) return { kind: 'resolved', ids: matches.map((b) => b.id) };
  return { kind: 'choose', quantity: selector.quantity, candidates: matches.map(candidateOf) };
}
