import { describe, expect, it, vi } from 'vitest';
import { createCityWorld } from '../simulation/cityAdapter';
import { initialCity } from '../data/initialCity';
import { createPlanningRequest, requestCityPlan } from './client';
import type { PlanProposal, PlanningConstraints } from '@tiny-city/ai-architect';

const constraints: PlanningConstraints = {
  allowPartial: false, allowDestructive: false, allowedDemolitions: [], allowedRoadRemovals: [],
  preserveBuildingIds: ['villa-seed-1'], budgetLimit: null, maxOperations: 128,
};

const proposal = {
  contractVersion: 1, planId: 'plan-test', digest: 'digest-test', sourceWorldId: 'villa-gardens-world',
  sourceRevision: 0, sourceFingerprint: 'fingerprint', seed: 1, status: 'VALIDATED', summary: 'Add a park',
  explanation: 'One park was placed.', intent: {}, constraints, placements: [], roads: { add: [], remove: [] },
  projectedPlan: {}, estimatedCost: 80, projectedBudget: 24_600,
  validation: { valid: true, fulfilled: true, operationCount: 1 }, warnings: [], commands: [],
} as unknown as PlanProposal;

describe('AI Architect HTTP client', () => {
  it('creates the versioned payload from one canonical snapshot and revision', () => {
    const snapshot = createCityWorld(initialCity);
    const request = createPlanningRequest('Add a park', snapshot, constraints);
    expect(request).toEqual({ contractVersion: 1, prompt: 'Add a park', world: snapshot,
      sourceRevision: snapshot.revision, constraints });
    expect(request.world).toBe(snapshot);
    expect(request.sourceRevision).toBe(snapshot.revision);
  });

  it('posts to the configured planning endpoint and returns a runtime-checked proposal', async () => {
    const snapshot = createCityWorld(initialCity);
    const request = createPlanningRequest('Add a park', snapshot, constraints);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ requestId: 'req-1', proposal }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const response = await requestCityPlan(request, new AbortController().signal, fetcher);
    expect(String(fetcher.mock.calls[0]?.[0])).toMatch(/\/v1\/city\/plan$/);
    const init = fetcher.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual(request);
    expect(response).toEqual({ requestId: 'req-1', proposal });
  });

  it('preserves the backend request ID and sanitized error code for HTTP errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      requestId: 'req-down', error: { code: 'PROVIDER_NOT_CONFIGURED', message: 'AI provider is not configured.', retryable: false },
    }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    await expect(requestCityPlan(createPlanningRequest('Add a park', createCityWorld(initialCity), constraints),
      new AbortController().signal, fetcher)).rejects.toMatchObject({
        code: 'PROVIDER_NOT_CONFIGURED', requestId: 'req-down', retryable: false,
      });
  });

  it('rejects malformed success envelopes before they can become preview data', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ requestId: 'req-bad', proposal: { status: 'VALIDATED' } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    await expect(requestCityPlan(createPlanningRequest('Add a park', createCityWorld(initialCity), constraints),
      new AbortController().signal, fetcher)).rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' });
  });
});
