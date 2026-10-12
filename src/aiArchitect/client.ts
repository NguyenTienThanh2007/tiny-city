import type { WorldState } from '@tiny-city/simulation';
import { isBuildingType } from '@tiny-city/simulation';
import { decodeConstraints, decodeIntent, DEFAULT_CONSTRAINTS } from '@tiny-city/ai-architect';
import type {
  ArchitectErrorResponse,
  PlanProposal,
  PlanningConstraints,
  PlanningRequest,
  PlanningResponse,
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

export function createPlanningRequest(
  prompt: string,
  snapshot: WorldState,
  constraints: PlanningConstraints,
): PlanningRequest {
  return {
    contractVersion: 1,
    prompt,
    world: snapshot,
    sourceRevision: snapshot.revision,
    constraints,
  };
}

export function apiBaseUrl(): string {
  return resolveApiBaseUrl(import.meta.env.VITE_AI_ARCHITECT_API_URL, import.meta.env.DEV);
}

/** Backend reachability and provider readiness, from cheap GET endpoints that never call Gemini. */
export type PlannerConnection =
  | { readonly state: 'connected'; readonly providerMode: 'gemini' | 'mock' | 'custom'; readonly providerConfigured: boolean; readonly plannerReady: boolean }
  | { readonly state: 'reachable'; readonly reason: string }
  | { readonly state: 'unavailable'; readonly reason: string };

export async function checkPlannerConnection(fetcher: typeof fetch = fetch, timeoutMs = 4000): Promise<PlannerConnection> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${apiBaseUrl()}/v1/city/status`, { method: 'GET', signal: controller.signal });
    let payload: unknown = null;
    try { payload = await response.json(); } catch { /* handled below */ }
    if (response.status === 404) {
      // Something answered, so the address is reachable; it just predates the status route (or is another service).
      return { state: 'reachable', reason: 'The server answered but has no planner status route, so provider readiness is unknown. Restart the API from apps/api to get full diagnostics.' };
    }
    if (!response.ok) {
      const reason = isArchitectError(payload) ? payload.error.message : `The planning service answered with HTTP ${response.status}.`;
      return { state: 'unavailable', reason };
    }
    if (!isRecord(payload) || payload.status !== 'ok' || !isRecord(payload.provider) ||
        !['gemini', 'mock', 'custom'].includes(String(payload.provider.mode)) || typeof payload.provider.configured !== 'boolean') {
      return { state: 'unavailable', reason: 'The service at this address is not the TINY CITY planning API.' };
    }
    return { state: 'connected', providerMode: payload.provider.mode as 'gemini' | 'mock' | 'custom',
      providerConfigured: payload.provider.configured, plannerReady: payload.planner === 'ready' };
  } catch {
    return { state: 'unavailable', reason: controller.signal.aborted ? 'The planning service did not answer in time.' : 'Could not reach the planning service.' };
  } finally {
    clearTimeout(timer);
  }
}

export async function requestCityPlan(
  request: PlanningRequest,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<PlanningResponse> {
  let response: Response;
  try {
    response = await fetcher(`${apiBaseUrl()}/v1/city/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
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
    throw new ArchitectClientError('PROVIDER_INVALID_RESPONSE', 'The planning service returned unreadable data.');
  }

  if (!response.ok) {
    if (isArchitectError(payload)) {
      throw new ArchitectClientError(payload.error.code, payload.error.message, payload.requestId, payload.error.retryable);
    }
    throw new ArchitectClientError('PROVIDER_INVALID_RESPONSE', 'The planning service returned an invalid error response.');
  }

  if (!isRecord(payload) || typeof payload.requestId !== 'string' || !isProposal(payload.proposal)) {
    throw new ArchitectClientError('PROVIDER_INVALID_RESPONSE', 'The planning service returned an invalid proposal.');
  }
  return payload as unknown as PlanningResponse;
}
