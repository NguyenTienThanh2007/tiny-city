import { describe, expect, it, vi } from 'vitest';
import { createCityWorld } from '../simulation/cityAdapter';
import { initialCity } from '../data/initialCity';
import { createPlanningRequest, plannerWorld, requestCityPlan } from './client';
import { createProposal } from '@tiny-city/ai-architect';
import type { ArchitectIntent, PlanProposal, PlanningConstraints } from '@tiny-city/ai-architect';

const constraints: PlanningConstraints = {
  allowPartial: false, allowDestructive: false, allowedDemolitions: [], allowedRoadRemovals: [],
  preserveBuildingIds: ['villa-seed-1'], budgetLimit: null, maxOperations: 128,
};

const intent: ArchitectIntent = {summary:'Add a park',language:'en',style:'compact',near:'existing',region:null,
  budgetLimit:null,connectRoads:true,builds:[{buildingType:'park',quantity:1,preferredPosition:null}],
  moves:[],demolish:[],roadAdd:[],roadRemove:[],preserveBuildingIds:[],unsupportedRequests:[],ambiguities:[],demolishTargets:[],moveTargets:[],preserveRoads:false,preserveTypes:[]};
const fixture = () => {
  const snapshot=createCityWorld(initialCity);
  return createProposal(snapshot,snapshot.revision,intent,1,constraints);
};

describe('AI Architect HTTP client', () => {
  it('creates the versioned payload from one canonical snapshot and revision', () => {
    const snapshot = createCityWorld(initialCity);
    const request = createPlanningRequest('Add a park', snapshot, constraints);
    // The planner receives the city exactly as it is, without the Phase 5 economy (accounts and ledger), Phase 6
    // transport or the Phase 7 society.
    const { economy, transport, society, ...city } = snapshot;
    expect(economy).toBeDefined();
    expect(transport).toBeDefined();
    expect(society).toBeDefined();
    expect(request).toEqual({ contractVersion: 1, prompt: 'Add a park', world: city, sourceRevision: snapshot.revision, constraints });
    expect(request.world).toEqual(plannerWorld(snapshot));
    expect(request.world.economy).toBeUndefined();
    expect(request.world.transport).toBeUndefined();
    expect(request.world.society).toBeUndefined();
    expect(request.world.plan).toBe(snapshot.plan);
    expect(request.world.budget).toBe(snapshot.budget);
    expect(request.sourceRevision).toBe(snapshot.revision);
  });

  it('posts to the configured planning endpoint and returns a runtime-checked proposal', async () => {
    const proposal=await fixture();
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

  it.each([
    ['null command', (p:PlanProposal)=>({...p,commands:[null]})],
    ['invalid road coordinates', (p:PlanProposal)=>({...p,commands:[{type:'city.edit-roads',add:[{x:'bad',y:0}],remove:[]}]})],
    ['unknown building type', (p:PlanProposal)=>({...p,placements:[{...p.placements[0],buildingType:'airport'}]})],
    ['malformed intent', (p:PlanProposal)=>({...p,intent:{...p.intent,builds:null}})],
    ['invalid constraints', (p:PlanProposal)=>({...p,constraints:{...p.constraints,allowDestructive:'yes'}})],
    ['invalid footprint', (p:PlanProposal)=>({...p,placements:[{...p.placements[0],footprint:{width:0,height:2}}]})],
    ['invalid seed', (p:PlanProposal)=>({...p,seed:-1})],
  ])('rejects %s before UI rendering', async (_name,patch) => {
    const payload={requestId:'bad-data',proposal:patch(await fixture())};
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload),{status:200}));
    await expect(requestCityPlan(createPlanningRequest('Add a park',createCityWorld(initialCity),constraints),
      new AbortController().signal,fetcher)).rejects.toMatchObject({code:'PROVIDER_INVALID_RESPONSE'});
  });
});
