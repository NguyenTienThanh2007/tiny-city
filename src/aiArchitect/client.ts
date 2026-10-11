import type { WorldState } from '@tiny-city/simulation';
import type {
  ArchitectErrorResponse,
  PlanProposal,
  PlanningConstraints,
  PlanningRequest,
  PlanningResponse,
} from '@tiny-city/ai-architect';

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

function isProposal(value: unknown): value is PlanProposal {
  if (!isRecord(value) || value.contractVersion !== 1 ||
    !['VALIDATED', 'REJECTED'].includes(String(value.status)) ||
    typeof value.planId !== 'string' || typeof value.digest !== 'string' ||
    typeof value.sourceWorldId !== 'string' || !Number.isSafeInteger(value.sourceRevision) ||
    typeof value.sourceFingerprint !== 'string' || typeof value.summary !== 'string' ||
    typeof value.explanation !== 'string' || !Array.isArray(value.placements) ||
    !isRecord(value.roads) || !Array.isArray(value.roads.add) || !value.roads.add.every(isPosition) ||
    !Array.isArray(value.roads.remove) || !value.roads.remove.every(isPosition) ||
    !isRecord(value.projectedPlan) || !Array.isArray(value.commands) ||
    !Number.isSafeInteger(value.estimatedCost) || !Number.isSafeInteger(value.projectedBudget) ||
    !isRecord(value.validation) || typeof value.validation.valid !== 'boolean' ||
    typeof value.validation.fulfilled !== 'boolean' || !Number.isSafeInteger(value.validation.operationCount) ||
    !Array.isArray(value.warnings) || !isRecord(value.intent) || !isRecord(value.constraints)) return false;

  return value.placements.every((placement) => isRecord(placement) &&
    typeof placement.buildingId === 'string' && typeof placement.buildingType === 'string' &&
    ['build', 'move'].includes(String(placement.operation)) && isPosition(placement.position) &&
    isRecord(placement.footprint) && Number.isSafeInteger(placement.footprint.width) &&
    Number.isSafeInteger(placement.footprint.height)) && value.warnings.every((warning) =>
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

function apiBaseUrl(): string {
  return (import.meta.env.VITE_AI_ARCHITECT_API_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
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
