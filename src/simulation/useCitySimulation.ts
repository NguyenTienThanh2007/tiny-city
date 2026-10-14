import { useCallback, useRef, useState } from 'react';
import { Simulation } from '@tiny-city/simulation';
import type { CityCommand, CitySnapshot, EconomyCommand, LifeCommand, PopulationOptions, SimulationEvent, SimulationResult, TransportCommand, WorldState } from '@tiny-city/simulation';
import type { CityState } from '../types';
import { createCityWorld } from './cityAdapter';

export type SimulationSpeed = 1 | 2 | 4;
export const SIMULATION_SPEEDS: readonly SimulationSpeed[] = [1, 2, 4];
type EventListener = (events: readonly SimulationEvent[], state: WorldState) => void;

/** Frequent per-tick bookkeeping that should not, on its own, force a React render of the whole HUD. */
const ROUTINE_EVENTS = new Set<SimulationEvent['type']>(['clock.ticked', 'citizen.moved',
  // Phase 6: trips start and end every few ticks at rush hour; the HUD refresh cadence covers them.
  'transport.trip-started', 'transport.trip-completed', 'transport.boarded', 'transport.alighted']);
/**
 * Phase 5: older saves start their economy when loaded (from the next full day, so nothing is billed retroactively).
 * Phase 6: every city has transportation; older saves start with no vehicles (they appear as residents travel).
 */
function withEconomy(simulation: Simulation): Simulation {
  simulation.enableEconomy();
  simulation.enableTransport();
  return simulation;
}
/** HUD refresh cadence while only routine movement happens. Pixi reads live state every frame regardless. */
const HUD_REFRESH_MS = 100;
/** Hidden-tab time is ignored, and one long frame can never replay more than this much real time. */
const MAX_FRAME_MS = 250;

export function useCitySimulation(city: CityState, restoredWorld?: WorldState) {
  const [simulation] = useState(() => withEconomy(new Simulation(restoredWorld ?? createCityWorld(city))));
  const [world, setWorld] = useState(simulation.getState());
  const [lastEvent, setLastEvent] = useState<SimulationEvent | null>(null);
  const [speed, setSpeedState] = useState<SimulationSpeed>(1);
  const speedRef = useRef<SimulationSpeed>(1);
  const listenersRef = useRef(new Set<EventListener>());
  const lastPublishRef = useRef(0);
  const pendingEventRef = useRef<SimulationEvent | null>(null);

  const notify = useCallback((result: SimulationResult) => {
    if (result.events.length === 0) return;
    for (const listener of listenersRef.current) listener(result.events, result.state);
  }, []);

  const rememberEvent = useCallback((events: readonly SimulationEvent[]) => {
    const event = [...events].reverse().find((entry) => !ROUTINE_EVENTS.has(entry.type) &&
      entry.type !== 'city.road-network-changed' && entry.type !== 'city.budget-changed') ?? events.at(-1);
    if (event) pendingEventRef.current = event;
  }, []);

  const publish = useCallback((result: SimulationResult) => {
    rememberEvent(result.events);
    notify(result);
    lastPublishRef.current = performance.now();
    setWorld(result.state);
    if (pendingEventRef.current) setLastEvent(pendingEventRef.current);
  }, [notify, rememberEvent]);

  const advance = useCallback((elapsedMs: number) => {
    // Pixi remains the only frame driver. Ignore hidden-tab time; cap long resumed frames.
    if (document.visibilityState === 'hidden' || simulation.getState().clock.paused) return;
    // Speed scales the real time fed to the one authoritative fixed-step clock; no second timer exists.
    const result = simulation.advance(Math.min(elapsedMs, MAX_FRAME_MS) * speedRef.current);
    if (result.steps === 0) return;
    const significant = result.events.some((event) => !ROUTINE_EVENTS.has(event.type));
    if (significant || performance.now() - lastPublishRef.current >= HUD_REFRESH_MS) {
      publish(result);
    } else {
      rememberEvent(result.events);
      notify(result);
    }
  }, [simulation, publish, notify, rememberEvent]);

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
  /** Phase 4 Life Mode commands go through the same simulation instance and publish immediately. */
  const executeLife = useCallback((command: LifeCommand) => {
    const result = simulation.executeLife(command);
    publish(result);
    return result;
  }, [simulation, publish]);
  /** Phase 5 policy changes apply immediately to future settlements; they are not city history. */
  const executeEconomy = useCallback((command: EconomyCommand) => {
    const result = simulation.executeEconomy(command);
    publish(result);
    return result;
  }, [simulation, publish]);
  /** Phase 6 bus-line management applies immediately (not city history). */
  const executeTransport = useCallback((command: TransportCommand) => {
    const result = simulation.executeTransport(command);
    publish(result);
    return result;
  }, [simulation, publish]);
  const canRestoreCity = useCallback((snapshot: CitySnapshot) => simulation.canRestoreCity(snapshot), [simulation]);
  const getNavigator = useCallback(() => simulation.getNavigator(), [simulation]);
  const restoreCity = useCallback((snapshot: CitySnapshot) => publish(simulation.restoreCity(snapshot)), [simulation, publish]);
  const getCitySnapshot = useCallback(() => simulation.getCitySnapshot(), [simulation]);

  const togglePause = useCallback(() => {
    if (simulation.getState().clock.paused) simulation.resume();
    else simulation.pause();
    setWorld(simulation.getState());
  }, [simulation]);
  const resume = useCallback(() => {
    if (!simulation.getState().clock.paused) return;
    simulation.resume();
    setWorld(simulation.getState());
  }, [simulation]);

  const step = useCallback(() => {
    if (simulation.getState().clock.paused) publish(simulation.step());
  }, [simulation, publish]);

  const setSpeed = useCallback((next: SimulationSpeed) => {
    speedRef.current = next;
    setSpeedState(next);
  }, []);

  const subscribe = useCallback((listener: EventListener) => {
    listenersRef.current.add(listener);
    return () => { listenersRef.current.delete(listener); };
  }, []);

  const getSnapshot = useCallback(() => simulation.getState(), [simulation]);
  const getCitizen = useCallback((id: string) => simulation.getCitizen(id), [simulation]);
  const getBuildingOccupancy = useCallback((id: string) => simulation.getBuildingOccupancy(id), [simulation]);
  const enablePopulation = useCallback((options: PopulationOptions = {}) => publish(simulation.enablePopulation(options)), [simulation, publish]);
  return { world, lastEvent, advance, execute, executeBatch, restoreCity, getCitySnapshot, togglePause, resume, step, getSnapshot,
    enablePopulation, speed, setSpeed, subscribe, getCitizen, getBuildingOccupancy, executeLife, getNavigator, executeEconomy, canRestoreCity, executeTransport };
}
