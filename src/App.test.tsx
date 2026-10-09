import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type CityViewport from './game/CityViewport';
import type { ComponentProps } from 'react';
import { initialCity } from './data/initialCity';
import { createCityWorld, toCityPlan } from './simulation/cityAdapter';
import { SAVE_KEY, saveCity } from './simulation/citySave';
import App from './App';

// Keep WebGL out of UI tests. Call the real editor handlers and frame boundary.
vi.mock('./game/CityViewport', () => ({
  default: (props: ComponentProps<typeof CityViewport>) => <div>
    <output data-testid="editor-city">{JSON.stringify(props.city)}</output>
    <output data-testid="simulation-world">{JSON.stringify(props.world)}</output>
    <button onClick={() => props.onSimulationFrame(100)}>Test frame</button>
    <button onClick={() => props.onSimulationFrame(50)}>Test half frame</button>
    <button onClick={() => props.onPlaceBuilding('villa', 40, 40)}>Test place villa</button>
    <button onClick={() => props.onAddRoad({ x: 42, y: 42 })}>Test paint road</button>
  </div>,
}));

function editorCity() { return JSON.parse(screen.getByTestId('editor-city').textContent!); }
function world() { return JSON.parse(screen.getByTestId('simulation-world').textContent!); }
function click(name: string) { fireEvent.click(screen.getByRole('button', { name })); }
function expectSynchronized() { expect(world().plan).toEqual(toCityPlan(editorCity())); }

describe('Phase 0 frontend integration', () => {
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

  it('preserves the local planner and keeps keyboard shortcuts away from its input', () => {
    render(<App />);
    const input = screen.getByRole('textbox', { name: 'Describe a city change' });
    fireEvent.change(input, { target: { value: 'build 3 villas' } });
    fireEvent.keyDown(input, { key: 'r' });
    expect(screen.getByTitle('Select · V')).toHaveAttribute('aria-pressed', 'true');
    click('Apply city plan');
    expect(editorCity().buildings).toHaveLength(15);
    expect(editorCity().funds).toBe(initialCity.funds - 360);
    expectSynchronized();
    fireEvent.keyDown(window, { key: 'r' });
    expect(screen.getByTitle('Road · R')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(editorCity().buildings).toHaveLength(12);
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
