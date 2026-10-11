import { serializeWorld } from '@tiny-city/simulation';
import type { WorldState } from '@tiny-city/simulation';
import type { PlanProposal } from './contracts.js';

export function canonical(value: unknown): string {
  return JSON.stringify(value, (_, entry: unknown) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : entry);
}
export async function hash(value: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function cityFingerprint(world: WorldState): Promise<string> {
  const copy = JSON.parse(serializeWorld(world)) as WorldState;
  return hash({ id: copy.id, revision: copy.revision, plan: copy.plan, budget: copy.budget, nextBuildingId: copy.nextBuildingId });
}
export function digestPayload(proposal: PlanProposal): unknown {
  const { digest: _digest, planId: _planId, status: _status, ...payload } = proposal;
  return payload;
}
