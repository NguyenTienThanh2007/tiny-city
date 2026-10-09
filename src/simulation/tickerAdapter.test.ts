import { describe, expect, it, vi } from 'vitest';
import { Ticker } from 'pixi.js';
import { Simulation } from '@tiny-city/simulation';
import { initialCity } from '../data/initialCity';
import { createCityWorld } from './cityAdapter';
import { connectSimulationTicker } from './tickerAdapter';

vi.hoisted(() => {
  // Pixi probes canvas support at import time; these ticker tests need no graphics context.
  HTMLCanvasElement.prototype.getContext = () => null;
});

describe('Pixi ticker / simulation integration', () => {
  it('advances the real core with millisecond deltas and removes its listener on teardown', () => {
    const ticker = new Ticker();
    ticker.lastTime = 0;
    const simulation = new Simulation(createCityWorld(initialCity));
    simulation.resume();
    const onFrame = vi.fn((elapsedMs: number) => simulation.advance(elapsedMs));
    const disconnect = connectSimulationTicker(ticker, onFrame);
    ticker.update(50);
    expect(onFrame).toHaveBeenLastCalledWith(50);
    expect(simulation.getState().clock.tick).toBe(0);
    ticker.update(100);
    expect(simulation.getState().clock.tick).toBe(1);
    expect(onFrame.mock.results.at(-1)?.value.events.at(-1).type).toBe('clock.ticked');
    disconnect();
    ticker.update(200);
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(simulation.getState().clock.tick).toBe(1);
    ticker.destroy();
  });
});
