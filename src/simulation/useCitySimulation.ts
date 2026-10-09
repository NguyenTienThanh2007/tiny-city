import { useCallback, useState } from 'react';
import { Simulation } from '@tiny-city/simulation';
import type { SimulationEvent, SimulationResult, WorldState } from '@tiny-city/simulation';
import type { CityState } from '../types';
import { createCityWorld, toCityPlan } from './cityAdapter';

export function useCitySimulation(city: CityState, restoredWorld?: WorldState) {
  const [simulation] = useState(() => new Simulation(restoredWorld ?? createCityWorld(city)));
  const [world, setWorld] = useState(simulation.getState());
  const [lastEvent, setLastEvent] = useState<SimulationEvent | null>(null);

  const publish = useCallback((result: SimulationResult) => {
    setWorld(result.state);
    const event = [...result.events].reverse().find((entry) => entry.type !== 'clock.ticked') ?? result.events.at(-1);
    if (event) setLastEvent(event);
  }, []);

  const advance = useCallback((elapsedMs: number) => {
    // Pixi remains the only frame driver. Ignore hidden-tab time; cap long resumed frames.
    if (document.visibilityState === 'hidden' || simulation.getState().clock.paused) return;
    const result = simulation.advance(Math.min(elapsedMs, 250));
    if (result.steps > 0) publish(result);
  }, [simulation, publish]);

  const syncCity = useCallback((nextCity: CityState) => {
    simulation.replacePlan(toCityPlan(nextCity));
    setWorld(simulation.getState());
  }, [simulation]);

  const togglePause = useCallback(() => {
    if (simulation.getState().clock.paused) simulation.resume();
    else simulation.pause();
    setWorld(simulation.getState());
  }, [simulation]);

  const step = useCallback(() => {
    if (simulation.getState().clock.paused) publish(simulation.step());
  }, [simulation, publish]);

  const getSnapshot = useCallback(() => simulation.getState(), [simulation]);
  return { world, lastEvent, advance, syncCity, togglePause, step, getSnapshot };
}
