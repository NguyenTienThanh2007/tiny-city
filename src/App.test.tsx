import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type CityViewport from './game/CityViewport';
import type { ComponentProps } from 'react';
import { createProposal, PlanError, PlanReview } from '@tiny-city/ai-architect';
import type { ArchitectIntent, PlanningRequest } from '@tiny-city/ai-architect';
import { CONSTRUCTION_COSTS } from '@tiny-city/simulation';
import { initialCity } from './data/initialCity';
import { createCityWorld, toCityPlan } from './simulation/cityAdapter';
import { SAVE_KEY, saveCity } from './simulation/citySave';
import App from './App';

// Keep WebGL out of UI tests. Call the real editor handlers and frame boundary.
vi.mock('./game/CityViewport', () => ({
  default: (props: ComponentProps<typeof CityViewport>) => <div>
    <output data-testid="moving-building">{props.movingBuildingId ?? "none"}</output>
    <button onClick={() => props.onBeginGesture?.()}>Test begin gesture</button>
    <button onClick={() => props.onEndGesture?.()}>Test end gesture</button>
    <button onClick={() => props.onBeginMoveBuilding(props.city.buildings.at(-1)!.id)}>Test begin move</button>
    <output data-testid="editor-city">{JSON.stringify(props.city)}</output>
    <output data-testid="simulation-world">{JSON.stringify(props.world)}</output>
    <output data-testid="architect-overlay">{props.proposal ? JSON.stringify({ status: props.proposal.status, placements: props.proposal.placements }) : 'none'}</output>
    <button onClick={() => props.onSimulationFrame(100)}>Test frame</button>
    <button onClick={() => props.onSimulationFrame(50)}>Test half frame</button>
    <button onClick={() => props.onPlaceBuilding('villa', 19, 10)}>Test place villa</button>
    <button onClick={() => props.onPlaceBuilding('villa', 40, 40)}>Test isolated villa</button>
    <button onClick={() => props.onPlaceBuilding('park', 40, 40)}>Test place park</button>
    <button onClick={() => props.onAddRoad({ x: 40, y: 39 })}>Test adjacent road</button>
    <button onClick={() => props.onBulldoze({ x: 40, y: 39 })}>Test remove road</button>
    <button onClick={() => props.onAddRoad({ x: 42, y: 42 })}>Test paint road</button>
    <button onClick={() => props.onCameraFootprintChange([
      { x: 16, y: 16 }, { x: 48, y: 16 }, { x: 48, y: 48 }, { x: 16, y: 48 },
    ])}>Test camera footprint</button>
  </div>,
}));

afterEach(() => vi.unstubAllGlobals());

const threeVillasIntent: ArchitectIntent = {
  summary: 'Build three villas near the park', language: 'vi', style: 'coastal', near: 'park',
  region: null, budgetLimit: null, connectRoads: true,
  builds: [{ buildingType: 'villa', quantity: 3, preferredPosition: null }],
  moves: [], demolish: [], roadAdd: [], roadRemove: [], preserveBuildingIds: [],
  unsupportedRequests: [], ambiguities: [],
};

function installPlanningFetch(
  onRequest?: (request: PlanningRequest) => void,
  intentForRequest: (request: PlanningRequest) => ArchitectIntent = () => threeVillasIntent,
) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as PlanningRequest;
    onRequest?.(request);
    const proposal = await createProposal(request.world, request.sourceRevision, intentForRequest(request), 21, request.constraints);
    return new Response(JSON.stringify({ requestId: 'request-test-1', proposal }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function editorCity() { return JSON.parse(screen.getByTestId('editor-city').textContent!); }
function world() { return JSON.parse(screen.getByTestId('simulation-world').textContent!); }
function click(name: string) { fireEvent.click(screen.getByRole('button', { name })); }
function expectSynchronized() { expect(world().plan).toEqual(toCityPlan(editorCity())); }

describe('frontend city/simulation integration', () => {
  it('maps building centers and the live camera footprint onto the minimap', () => {
    render(<App />);
    expect(screen.getByTestId('minimap-building-villa-seed-1')).toHaveAttribute('cx', '23.4375');
    expect(screen.getByTestId('minimap-building-villa-seed-1')).toHaveAttribute('cy', '23.4375');
    expect(screen.getByTestId('minimap-road-first')).toHaveAttribute('cy', '16.40625');
    click('Test camera footprint');
    expect(screen.getByTestId('minimap-camera')).toHaveAttribute('points', '25,25 75,25 75,75 25,75');
  });

  it('rejects isolated homes and charges only authoritative successful commands', () => {
    render(<App />);
    click('Test isolated villa');
    expect(screen.getByRole('status', { name: 'City notice' })).toHaveTextContent('must touch a road');
    expect(editorCity().funds).toBe(initialCity.funds);
    expect(world().nextBuildingId).toBe(1);
    expect(world().revision).toBe(0);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    click('Test adjacent road');
    expect(world().budget.totalSpent).toBe(8);
    expect(screen.getByLabelText('Latest simulation event')).toHaveTextContent('city.roads-edited');
    click('Test isolated villa');
    expect(editorCity().buildings).toHaveLength(13);
    expect(world().budget).toEqual({ openingBalance: initialCity.funds, balance: initialCity.funds - 128, totalSpent: 128 });
    expect(world().plan.buildings.at(-1).id).toBe('building-1');
    expect(screen.getByLabelText('Latest simulation event')).toHaveTextContent('city.building-built');
    expectSynchronized();
  });

  it('supports parks without road access and keeps IDs unique across abandoned undo history', () => {
    render(<App />);
    click('Test place park');
    expect(world().plan.buildings.at(-1).type).toBe('park');
    expect(world().budget.totalSpent).toBe(80);
    click('Undo');
    expect(editorCity().funds).toBe(initialCity.funds);
    expect(world().budget.totalSpent).toBe(0);
    click('Test place park');
    expect(world().plan.buildings.at(-1).id).toBe('building-2');
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
    expectSynchronized();
  });

  it('removes roads without refunds or deleting neighboring buildings and supports budget undo/redo', () => {
    render(<App />);
    click('Test adjacent road');
    click('Test isolated villa');
    click('Test remove road');
    expect(editorCity().roads).toHaveLength(initialCity.roads.length);
    expect(editorCity().buildings).toHaveLength(13);
    expect(world().budget.totalSpent).toBe(128);
    click('Undo');
    expect(editorCity().roads).toHaveLength(initialCity.roads.length + 1);
    expect(world().budget.totalSpent).toBe(128);
    click('Undo');
    expect(world().budget.totalSpent).toBe(8);
    expect(editorCity().buildings).toHaveLength(12);
    click('Redo');
    expect(world().budget.totalSpent).toBe(128);
    expectSynchronized();
  });

  it('keeps manual road edits undoable after replacing the local AI prompt parser', () => {
    render(<App />);
    click('Test adjacent road');
    click('Test paint road');
    expect(editorCity().roads).toHaveLength(initialCity.roads.length + 2);
    expect(world().budget.totalSpent).toBe(16);
    click('Undo');
    expect(editorCity().roads).toHaveLength(initialCity.roads.length + 1);
    expect(world().budget.totalSpent).toBe(8);
    click('Redo');
    expect(world().budget.totalSpent).toBe(16);
    expectSynchronized();
  });

  it('connects resume, pause, manual stepping, event output, and the live clock', () => {
    render(<StrictMode><App /></StrictMode>);
    expect(screen.getByLabelText('Simulation clock')).toHaveTextContent('DAY 01 · 00:00');
    click('Test frame');
    expect(world().clock.tick).toBe(0);
    click('Resume');
    expect(screen.getByRole('button', { name: 'Step' })).toBeDisabled();
    click('Test frame');
    expect(screen.getByLabelText('Simulation clock')).toHaveTextContent('DAY 01 · 00:01');
    expect(screen.getByLabelText('Latest simulation event')).toHaveTextContent('clock.ticked · tick 1');
    click('Pause');
    click('Test frame');
    expect(world().clock.tick).toBe(1);
    click('Step');
    expect(world().clock.tick).toBe(2);
    expect(world().clock.paused).toBe(true);
  });

  it('updates day UI from midnight events', () => {
    const initial = createCityWorld(initialCity);
    saveCity(localStorage, initialCity, { ...initial, clock: { ...initial.clock, tick: 1439 } });
    render(<App />);
    expect(screen.getByLabelText('Simulation clock')).toHaveTextContent('DAY 01 · 23:59');
    click('Step');
    expect(screen.getByLabelText('Simulation clock')).toHaveTextContent('DAY 02 · 00:00');
    expect(screen.getByLabelText('Latest simulation event')).toHaveTextContent('clock.day-started · tick 1440');
  });

  it('preserves placement, road painting, funds, undo/redo, and bulldozing without restarting time', () => {
    render(<App />);
    click('Step');
    click('Test place villa');
    expect(editorCity().buildings).toHaveLength(13);
    expect(editorCity().funds).toBe(initialCity.funds - 120);
    expectSynchronized();
    click('Building details');
    expect(screen.getByRole('status', { name: 'City notice' })).toHaveTextContent('home · capacity 2');
    click('Test paint road');
    expect(editorCity().funds).toBe(initialCity.funds - 128);
    expectSynchronized();
    click('Undo');
    expect(editorCity().roads).toEqual(initialCity.roads);
    expect(editorCity().funds).toBe(initialCity.funds - 120);
    expectSynchronized();
    click('Redo');
    expect(editorCity().funds).toBe(initialCity.funds - 128);
    expectSynchronized();
    click('Test place villa'); // occupied lot remains rejected, with no funds change
    expect(editorCity().funds).toBe(initialCity.funds - 128);
    expect(world().clock.tick).toBe(1);
  });

  it('preserves selected-building bulldozing and undo while paused', () => {
    render(<App />);
    click('Step');
    click('Test place villa');
    click('Bulldoze selected building');
    expect(editorCity().buildings).toHaveLength(12);
    expectSynchronized();
    click('Undo');
    expect(editorCity().buildings).toHaveLength(13);
    expect(world().clock.tick).toBe(1);
    expectSynchronized();
  });

  it('sends natural language to the backend, previews without mutation, and applies only after approval', async () => {
    let sentRequest: PlanningRequest | undefined;
    const fetchMock = installPlanningFetch((request) => { sentRequest = request; });
    render(<App />);
    const initial = world();
    const input = screen.getByRole('textbox', { name: 'Describe a city change' });
    fireEvent.change(input, { target: { value: 'Xây 3 biệt thự gần công viên' } });
    fireEvent.keyDown(input, { key: 'r' });
    expect(screen.getByTitle('Select · V')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByRole('button', { name: 'Approve & build' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentRequest?.contractVersion).toBe(1);
    expect(sentRequest?.prompt).toBe('Xây 3 biệt thự gần công viên');
    expect(sentRequest?.world).toEqual(initial);
    expect(sentRequest?.sourceRevision).toBe(initial.revision);
    expect(sentRequest?.constraints).toMatchObject({ allowPartial: false, allowDestructive: false, maxOperations: 128 });
    expect(sentRequest?.constraints?.preserveBuildingIds).toHaveLength(initial.plan.buildings.length);
    expect(world()).toEqual(initial);
    expect(editorCity().funds).toBe(initialCity.funds);
    expect(screen.getByTestId('architect-overlay')).toHaveTextContent('PREVIEWED');

    click('Approve & build');
    await screen.findByText('AI city plan applied. Undo is available.');
    expect(editorCity().buildings).toHaveLength(initialCity.buildings.length + 3);
    const finalWorld = world();
    const addedRoadTiles = finalWorld.plan.roads.length - initial.plan.roads.length;
    expect(initial.budget.balance - finalWorld.budget.balance).toBe(360 + addedRoadTiles * CONSTRUCTION_COSTS.road);
    expect(world().revision).toBeGreaterThan(initial.revision);
    expect(screen.getByTestId('architect-overlay')).toHaveTextContent('none');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    expectSynchronized();
    click('Undo');
    expect(world().budget.balance).toBe(initial.budget.balance);
    expectSynchronized();
  });

  it('cancels an in-flight planning request without allowing a late response to change the city', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe a city change' }), { target: { value: 'Add a park' } });
    click('Generate AI plan');
    await screen.findByRole('button', { name: 'Cancel planning request' });
    click('Cancel planning request');
    expect(await screen.findByText('Planning was cancelled. Your city is unchanged.')).toBeInTheDocument();
    expect(editorCity()).toEqual(initialCity);
    expect(world().revision).toBe(0);
    expect(screen.getByTestId('architect-overlay')).toHaveTextContent('none');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects and regenerates the same plan, then preserves the atomic edit through undo, redo, save and reload', async () => {
    const fetchMock=installPlanningFetch();
    const first=render(<App />);
    const initial=world();
    fireEvent.change(screen.getByRole('textbox',{name:'Describe a city change'}),{target:{value:'Build three villas'}});
    click('Generate AI plan');await screen.findByRole('button',{name:'Approve & build'});
    click('Reject');await screen.findByText('Proposal rejected. Your city is unchanged.');
    expect(world()).toEqual(initial);
    click('Generate AI plan');await screen.findByRole('button',{name:'Approve & build'});
    expect(world()).toEqual(initial);
    click('Approve & build');await screen.findByText('AI city plan applied. Undo is available.');
    const appliedPlan=world().plan;const appliedBudget=world().budget;
    expect(appliedPlan.buildings).toHaveLength(initial.plan.buildings.length+3);
    click('Undo');expect(world().plan).toEqual(initial.plan);expect(world().budget).toEqual(initial.budget);
    click('Redo');expect(world().plan).toEqual(appliedPlan);expect(world().budget).toEqual(appliedBudget);
    click('Save');const saved=JSON.parse(localStorage.getItem(SAVE_KEY)!);
    first.unmount();render(<App />);
    expect(world()).toEqual(saved.simulation);expectSynchronized();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('releases a failed approval session so the unchanged proposal can be regenerated', async () => {
    installPlanningFetch();render(<App />);const initial=world();
    const failure=vi.spyOn(PlanReview.prototype,'apply').mockRejectedValueOnce(new PlanError('PLAN_REJECTED','The simulation temporarily rejected this plan.'));
    fireEvent.change(screen.getByRole('textbox',{name:'Describe a city change'}),{target:{value:'Build three villas'}});
    click('Generate AI plan');await screen.findByRole('button',{name:'Approve & build'});
    click('Approve & build');await screen.findByText('The simulation temporarily rejected this plan.');
    expect(world()).toEqual(initial);
    click('Generate AI plan');await screen.findByRole('button',{name:'Approve & build'});
    click('Approve & build');await screen.findByText('AI city plan applied. Undo is available.');
    expect(world().plan.buildings).toHaveLength(initial.plan.buildings.length+3);failure.mockRestore();
  });

  it('requires a second explicit confirmation before a destructive proposal can apply', async () => {
    let sentRequest: PlanningRequest | undefined;
    installPlanningFetch((request) => { sentRequest = request; }, (request) => ({
      ...threeVillasIntent, summary: 'Remove one existing villa', builds: [], connectRoads: false,
      demolish: [request.world.plan.buildings[0]!.id],
    }));
    render(<App />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Protect existing buildings' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow demolition / road removal proposals' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe a city change' }), { target: { value: 'Demolish the first villa' } });
    click('Generate AI plan');
    await screen.findByRole('button', { name: 'Review destructive edits' });
    expect(sentRequest?.constraints?.allowDestructive).toBe(true);
    expect(sentRequest?.constraints?.preserveBuildingIds).toEqual([]);
    expect(sentRequest?.constraints?.allowedDemolitions).toEqual(world().plan.buildings.map((building: { id: string }) => building.id));

    const originalWorld = world();
    click('Review destructive edits');
    expect(screen.getByRole('alertdialog', { name: 'Confirm destructive changes' })).toHaveTextContent('Demolish Villa 01');
    expect(world()).toEqual(originalWorld);
    click('Go back');
    expect(world()).toEqual(originalWorld);

    click('Review destructive edits');
    click('Confirm & apply');
    await screen.findByText('AI city plan applied. Undo is available.');
    expect(world().plan.buildings).toHaveLength(originalWorld.plan.buildings.length - 1);
    expect(world().budget.balance).toBe(originalWorld.budget.balance);
    expectSynchronized();
  });

  it('clears a preview as soon as a manual city edit makes the proposal stale', async () => {
    installPlanningFetch();
    render(<App />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe a city change' }), { target: { value: 'Build 3 villas near the park' } });
    click('Generate AI plan');
    await screen.findByRole('button', { name: 'Approve & build' });
    expect(screen.getByTestId('architect-overlay')).toHaveTextContent('PREVIEWED');
    click('Test place villa');
    expect(await screen.findByText('The city changed after preview. Generate a fresh plan before applying.')).toBeInTheDocument();
    expect(screen.getByTestId('architect-overlay')).toHaveTextContent('none');
    expect(screen.queryByRole('button', { name: 'Approve & build' })).not.toBeInTheDocument();
    expect(world().revision).toBe(1);
    expect(editorCity().buildings).toHaveLength(initialCity.buildings.length + 1);
    expectSynchronized();
    fireEvent.keyDown(window, { key: 'r' });
    expect(screen.getByTitle('Road · R')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(editorCity().buildings).toHaveLength(initialCity.buildings.length);
    expectSynchronized();
  });

  it('loads legacy saves and restores edited maps plus complete simulation snapshots', () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...initialCity, funds: 1000 }));
    const first = render(<App />);
    click('Test paint road');
    click('Resume');
    click('Test frame');
    click('Test half frame');
    click('Save');
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY)!);
    expect(saved.funds).toBe(992);
    expect(saved.simulation.clock).toMatchObject({ tick: 1, accumulatedMs: 50, paused: false });
    expect(screen.getByRole('button', { name: 'Saved' })).toBeInTheDocument();
    first.unmount();
    render(<App />);
    expect(editorCity().funds).toBe(992);
    expect(world()).toEqual(saved.simulation);
    expectSynchronized();
    click('Test frame');
    expect(world().clock.tick).toBe(2);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('reports save failures without changing the current city', () => {
    render(<App />);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    click('Save');
    expect(screen.getByRole('status', { name: 'City notice' })).toHaveTextContent('Could not save this city');
    expect(editorCity().buildings).toHaveLength(initialCity.buildings.length);
    spy.mockRestore();
  });

  it('does not advance from hidden-tab frames', () => {
    render(<App />);
    click('Resume');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => click('Test frame'));
    expect(world().clock.tick).toBe(0);
    visibility.mockRestore();
    click('Test frame');
    expect(world().clock.tick).toBe(1);
  });
});


describe('acceptance history and move lifecycle', () => {
  it('cancels an abandoned move after undo instead of retaining a removed building ID', () => {
    render(<App />);
    click('Test place park');
    click('Test begin move');
    expect(screen.getByTestId('moving-building')).toHaveTextContent('building-1');
    click('Undo');
    expect(screen.getByTestId('moving-building')).toHaveTextContent('none');
    expect(editorCity().buildings.some((building: { id: string }) => building.id === 'building-1')).toBe(false);
    click('Redo');
    expect(screen.getByTestId('moving-building')).toHaveTextContent('none');
  });

  it('records an entire pointer stroke in one history entry', () => {
    render(<App />);
    click('Test begin gesture');
    click('Test paint road');
    click('Test adjacent road');
    click('Test end gesture');
    expect(editorCity().funds).toBe(initialCity.funds - 16);
    click('Undo');
    expect(editorCity().roads).toEqual(initialCity.roads);
    expect(editorCity().funds).toBe(initialCity.funds);
    click('Redo');
    expect(editorCity().roads).toHaveLength(initialCity.roads.length + 2);
  });
});
