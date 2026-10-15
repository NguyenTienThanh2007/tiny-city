import type { WorldState } from '@tiny-city/simulation';
import { isBuildingType, providesLeisure } from '@tiny-city/simulation';
import { decodeConstraints, decodeIntent, DEFAULT_CONSTRAINTS } from '@tiny-city/ai-architect';
import type {
  ArchitectErrorResponse,
  PlanProposal,
  PlanningConstraints,
  PlanningRequest,
  PlanningResponse,
  ValidationRequest,
} from '@tiny-city/ai-architect';

import { resolveApiBaseUrl } from './devProxy';

type JsonRecord = Record<string, unknown>;

export class ArchitectClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ArchitectClientError';
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPosition(value: unknown): boolean {
  return isRecord(value) && Number.isSafeInteger(value.x) && Number.isSafeInteger(value.y);
}

function isCommand(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'city.build': return isBuildingType(value.buildingType) && isPosition(value.position) &&
      (value.name === undefined || typeof value.name === 'string');
    case 'city.move-building': return typeof value.buildingId === 'string' && isPosition(value.position);
    case 'city.demolish': return typeof value.buildingId === 'string';
    case 'city.edit-roads': return Array.isArray(value.add) && value.add.every(isPosition) &&
      Array.isArray(value.remove) && value.remove.every(isPosition);
    default: return false;
  }
}

function isProposal(value: unknown): value is PlanProposal {
  if (!isRecord(value) || value.contractVersion !== 1 ||
    !['VALIDATED', 'REJECTED'].includes(String(value.status)) ||
    typeof value.planId !== 'string' || typeof value.digest !== 'string' ||
    typeof value.sourceWorldId !== 'string' || !Number.isSafeInteger(value.sourceRevision) ||
    typeof value.sourceFingerprint !== 'string' || typeof value.summary !== 'string' ||
    typeof value.explanation !== 'string' || !Array.isArray(value.placements) ||
    !isRecord(value.roads) || !Array.isArray(value.roads.add) || !value.roads.add.every(isPosition) ||
    !Array.isArray(value.roads.remove) || !value.roads.remove.every(isPosition) ||
    !isRecord(value.projectedPlan) || !Array.isArray(value.commands) || !value.commands.every(isCommand) ||
    !Number.isSafeInteger(value.seed) || Number(value.seed) < 0 || Number(value.seed) > 2**32-1 ||
    !Number.isSafeInteger(value.estimatedCost) || !Number.isSafeInteger(value.projectedBudget) ||
    !isRecord(value.validation) || typeof value.validation.valid !== 'boolean' ||
    typeof value.validation.fulfilled !== 'boolean' || !Number.isSafeInteger(value.validation.operationCount) ||
    !Array.isArray(value.warnings) || !isRecord(value.intent) || !isRecord(value.constraints)) return false;

  const constraints=value.constraints;
  if (!Object.keys(DEFAULT_CONSTRAINTS).every(key=>Object.hasOwn(constraints,key))) return false;
  try { decodeIntent(value.intent); decodeConstraints(constraints); } catch { return false; }
  return value.placements.every((placement) => isRecord(placement) &&
    typeof placement.buildingId === 'string' && isBuildingType(placement.buildingType) &&
    ['build', 'move'].includes(String(placement.operation)) && isPosition(placement.position) &&
    isRecord(placement.footprint) && Number.isSafeInteger(placement.footprint.width) &&
    Number.isSafeInteger(placement.footprint.height) && Number(placement.footprint.width)>0 &&
    Number(placement.footprint.height)>0) && value.warnings.every((warning) =>
    isRecord(warning) && typeof warning.code === 'string' && typeof warning.message === 'string');
}

function isArchitectError(value: unknown): value is ArchitectErrorResponse {
  return isRecord(value) && typeof value.requestId === 'string' && isRecord(value.error) &&
    typeof value.error.code === 'string' && typeof value.error.message === 'string' &&
    typeof value.error.retryable === 'boolean';
}

/**
 * The world as the planner sees it: the city without its Phase 5 economy, Phase 6 transportation or Phase 7 society
 * (accounts, ledger, vehicles, trips, personalities and relationships would only enlarge the request). Residents in a
 * vehicle or at a stop are sent as waiting walkers, and residents out at an entertainment venue or a friend's home
 * as idle visitors there, which the planner treats the same. The plan fingerprint covers the plan and budget, which
 * are sent unchanged.
 */
export function plannerWorld(snapshot: WorldState): WorldState {
  const { economy: _economy, transport: _transport, society: _society, ...world } = snapshot;
  const buildings = new Map(snapshot.plan.buildings.map((b) => [b.id, b]));
  const visiting = (c: WorldState['citizens'][number]) => c.activity === 'leisure' && c.movement?.status === 'inside' && c.movement.currentBuildingId !== null &&
    !providesLeisure(buildings.get(c.movement.currentBuildingId)!);
  if (!snapshot.citizens.some((c) => c.movement?.status === 'vehicle' || visiting(c))) return world;
  return { ...world, citizens: snapshot.citizens.map((c) => c.movement?.status === 'vehicle' ? { ...c, movement: { ...c.movement, status: 'waiting' } }
    : visiting(c) ? { ...c, activity: 'idle' } : c) };
}

export function createPlanningRequest(
  prompt: string,
  snapshot: WorldState,
  constraints: PlanningConstraints,
): PlanningRequest {
  return {
    contractVersion: 1,
    prompt,
    world: plannerWorld(snapshot),
    sourceRevision: snapshot.revision,
    constraints,
  };
}

export function apiBaseUrl(): string {
  return resolveApiBaseUrl(import.meta.env.VITE_AI_ARCHITECT_API_URL, import.meta.env.DEV);
}

/** Backend reachability and provider readiness, from cheap GET endpoints that never call Gemini. */
export type PlannerConnection =
  | { readonly state: 'connected'; readonly providerMode: 'gemini' | 'mock' | 'local' | 'custom'; readonly providerConfigured: boolean; readonly plannerReady: boolean; readonly model: string | null }
  | { readonly state: 'reachable'; readonly reason: string }
  /** Something else answers at the planner address (another app on the same port, or a wrong URL). */
  | { readonly state: 'wrong-service'; readonly reason: string; readonly serviceName: string | null }
  | { readonly state: 'unavailable'; readonly reason: string };

/** Identifies what answered with a 404: an older TINY CITY API, or a different service on the same port. */
async function identifyService(fetcher: typeof fetch, signal: AbortSignal): Promise<{ tinyCity: boolean; name: string | null }> {
  try {
    const health = await fetcher(`${apiBaseUrl()}/health`, { method: 'GET', signal });
    const body: unknown = await health.json().catch(() => null);
    if (health.ok && isRecord(body) && body.service === 'tiny-city-api') return { tinyCity: true, name: 'TINY CITY API' };
  } catch { /* fall through */ }
  try {
    const docs = await fetcher(`${apiBaseUrl()}/openapi.json`, { method: 'GET', signal });
    const body: unknown = await docs.json().catch(() => null);
    const title = isRecord(body) && isRecord(body.info) && typeof body.info.title === 'string' ? body.info.title.slice(0, 60) : null;
    return { tinyCity: title === 'TINY CITY API', name: title };
  } catch { return { tinyCity: false, name: null }; }
}
const wrongService = (name: string | null): PlannerConnection => ({ state: 'wrong-service', serviceName: name,
  reason: `${name ? `“${name}”` : 'A different service'} is answering at the planner address instead of the TINY CITY API, so planning requests fail with HTTP 404. ` +
    `It is probably another app using the same port. Start the planner with npm run dev:api (it picks a free port and checks for this), or set TINY_CITY_API_PROXY_TARGET.` });

export async function checkPlannerConnection(fetcher: typeof fetch = fetch, timeoutMs = 4000): Promise<PlannerConnection> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${apiBaseUrl()}/v1/city/status`, { method: 'GET', signal: controller.signal });
    let payload: unknown = null;
    try { payload = await response.json(); } catch { /* handled below */ }
    if (response.status === 404) {
      // A 404 is either an older TINY CITY API without the status route, or a different service on this port.
      const identity = await identifyService(fetcher, controller.signal);
      if (!identity.tinyCity) return wrongService(identity.name);
      return { state: 'reachable', reason: 'This TINY CITY API predates readiness reporting. Restart it from this branch (npm run dev:api) for full diagnostics.' };
    }
    if (!response.ok) {
      const reason = isArchitectError(payload) ? payload.error.message : `The planning service answered with HTTP ${response.status}.`;
      return { state: 'unavailable', reason };
    }
    if (!isRecord(payload) || payload.status !== 'ok' || !isRecord(payload.provider) || (payload.service !== undefined && payload.service !== 'tiny-city-api') ||
        !['gemini', 'mock', 'local', 'custom'].includes(String(payload.provider.mode)) || typeof payload.provider.configured !== 'boolean') {
      return wrongService(null);
    }
    return { state: 'connected', providerMode: payload.provider.mode as 'gemini' | 'mock' | 'local' | 'custom',
      providerConfigured: payload.provider.configured, plannerReady: payload.planner === 'ready',
      model: typeof payload.provider.model === 'string' ? payload.provider.model : null };
  } catch {
    return { state: 'unavailable', reason: controller.signal.aborted ? 'The planning service did not answer in time.' : 'Could not reach the planning service.' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A failure that does not use the planner's error contract came from something else: a different service on the
 * port, a proxy or gateway. Say which HTTP status it was and what to do, instead of "invalid error response".
 */
export function foreignHttpError(status: number): ArchitectClientError {
  if (status === 404 || status === 405) {
    return new ArchitectClientError('PLANNER_NOT_FOUND', `The planner address answered HTTP ${status}: this is not the TINY CITY planning API. Another app is probably using the port — start the planner with npm run dev:api or point TINY_CITY_API_PROXY_TARGET at it.`, null, false);
  }
  if (status === 413) return new ArchitectClientError('REQUEST_TOO_LARGE', 'The city is too large to send for planning (HTTP 413).', null, false);
  if (status >= 500) return new ArchitectClientError('PROVIDER_UNAVAILABLE', `The planning service or a proxy failed with HTTP ${status}. Check that the planner is running, then retry.`, null, true);
  return new ArchitectClientError('PLANNER_HTTP_ERROR', `The planning service answered HTTP ${status} without a planner error. Check the API address and version.`, null, false);
}

const EMPTY_IMPACT = { buildingsAdded: 0, buildingsRemoved: 0, buildingsMoved: 0, roomsAdded: 0, roomsRemoved: 0, residentsRemoved: 0, residentsRehoused: 0, playerHomeRemoved: false };

/** Older planners omit the 2.0 fields; normalize so the UI always has clarifications, authorization and impact. */
function normalizeProposal(proposal: PlanProposal): PlanProposal {
  const raw = proposal as Partial<PlanProposal> & PlanProposal;
  return { ...raw, clarifications: Array.isArray(raw.clarifications) ? raw.clarifications : [],
    authorization: isRecord(raw.authorization) ? raw.authorization : null, impact: isRecord(raw.impact) ? raw.impact : EMPTY_IMPACT };
}

async function postPlanning(path: string, body: unknown, signal: AbortSignal, fetcher: typeof fetch): Promise<PlanningResponse> {
  let response: Response;
  try {
    response = await fetcher(`${apiBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ArchitectClientError('PROVIDER_UNAVAILABLE', 'Could not reach the AI planning service.', null, true);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) throw foreignHttpError(response.status);
    throw new ArchitectClientError('PROVIDER_INVALID_RESPONSE', 'The planning service returned unreadable data.');
  }

  if (!response.ok) {
    if (isArchitectError(payload)) {
      throw new ArchitectClientError(payload.error.code, payload.error.message, payload.requestId, payload.error.retryable);
    }
    throw foreignHttpError(response.status);
  }

  if (!isRecord(payload) || typeof payload.requestId !== 'string' || !isProposal(payload.proposal)) {
    throw new ArchitectClientError('PROVIDER_INVALID_RESPONSE', 'The planning service returned an invalid proposal.');
  }
  return { requestId: payload.requestId, proposal: normalizeProposal(payload.proposal) };
}

export function requestCityPlan(request: PlanningRequest, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<PlanningResponse> {
  return postPlanning('/v1/city/plan', request, signal, fetcher);
}

/**
 * Re-plans an already interpreted intent (no AI call): used after the user picks targets for an ambiguous request
 * or explicitly authorizes protected/destructive edits.
 */
export function requestPlanValidation(request: ValidationRequest, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<PlanningResponse> {
  return postPlanning('/v1/city/plan/validate', request, signal, fetcher);
}
