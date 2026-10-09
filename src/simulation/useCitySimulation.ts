import { useCallback, useState } from 'react';
import { Simulation } from '@tiny-city/simulation';
import type { CityCommand, CitySnapshot, SimulationEvent, SimulationResult, WorldState } from '@tiny-city/simulation';
import type { CityState } from '../types';
import { createCityWorld } from './cityAdapter';

export function useCitySimulation(city: CityState, restoredWorld?: WorldState) {
  const [simulation] = useState(() => new Simulation(restoredWorld ?? createCityWorld(city)));
  const [world, setWorld] = useState(simulation.getState());
  const [lastEvent, setLastEvent] = useState<SimulationEvent | null>(null);

  const publish = useCallback((result: SimulationResult) => {
    setWorld(result.state);
    const event = [...result.events].reverse().find((entry) => entry.type !== 'clock.ticked' &&
      entry.type !== 'city.road-network-changed' && entry.type !== 'city.budget-changed') ?? result.events.at(-1);
    if (event) setLastEvent(event);
  }, []);

  const advance = useCallback((elapsedMs: number) => {
    // Pixi remains the only frame driver. Ignore hidden-tab time; cap long resumed frames.
    if (document.visibilityState === 'hidden' || simulation.getState().clock.paused) return;
    const result = simulation.advance(Math.min(elapsedMs, 250));
    if (result.steps > 0) publish(result);
  }, [simulation, publish]);

  const execute = useCallback((command: CityCommand) => {
    const result = simulation.execute(command);
    publish(result);
    return result;
  }, [simulation, publish]);
  const executeBatch = useCallback((commands: readonly CityCommand[]) => {
    const result = simulation.executeBatch(commands);
    publish(result);
    return result;
  }, [simulation, publish]);
  const restoreCity = useCallback((snapshot: CitySnapshot) => publish(simulation.restoreCity(snapshot)), [simulation, publish]);
  const getCitySnapshot = useCallback(() => simulation.getCitySnapshot(), [simulation]);

  const togglePause = useCallback(() => {
    if (simulation.getState().clock.paused) simulation.resume();
    else simulation.pause();
    setWorld(simulation.getState());
  }, [simulation]);

  const step = useCallback(() => {
    if (simulation.getState().clock.paused) publish(simulation.step());
  }, [simulation, publish]);

  const getSnapshot = useCallback(() => simulation.getState(), [simulation]);
  return { world, lastEvent, advance, execute, executeBatch, restoreCity, getCitySnapshot, togglePause, step, getSnapshot };
}
