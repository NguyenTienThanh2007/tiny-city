import type { Ticker } from 'pixi.js';

/** Connect once per Pixi application; return a matching teardown for effect cleanup. */
export function connectSimulationTicker(ticker: Ticker, onFrame: (elapsedMs: number) => void): () => void {
  const listener = (frame: Ticker) => onFrame(frame.deltaMS);
  ticker.add(listener);
  return () => { ticker.remove(listener); };
}
