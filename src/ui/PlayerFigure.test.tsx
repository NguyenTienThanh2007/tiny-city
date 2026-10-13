import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE } from '../game/playerLook';
import { PlayerFigure, PlayerPortrait } from './PlayerFigure';

// Baked character art without real atlases: every layer is a tiny image source.
vi.mock('../game/art/artLibrary', () => {
  const library = {
    index: { manifest: { characters: { height: 0.8 } } },
    source: () => ({ image: document.createElement('canvas'), x: 0, y: 0, w: 4, h: 4, ax: 2, ay: 4, resolution: 2 }),
  };
  return { currentArt: () => library, loadArt: () => Promise.resolve(library) };
});

let encodes: ReturnType<typeof vi.fn>;
let contexts: unknown[][];

beforeEach(() => {
  vi.useFakeTimers();
  encodes = vi.fn(() => 'data:image/png;base64,AAAA');
  contexts = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(encodes as unknown as HTMLCanvasElement['toDataURL']);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (...args: unknown[]) {
    contexts.push(args);
    return null;
  } as unknown as HTMLCanvasElement['getContext']);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('baked player figure', () => {
  it('encodes the creator walk cycle once, then only swaps cached frames', () => {
    const appearance = { ...DEFAULT_APPEARANCE, hairColor: 3 };
    render(<PlayerFigure appearance={appearance} title="Preview of Mai" animate />);
    // Five full walk cycles (40 ticks at 115 ms).
    act(() => { vi.advanceTimersByTime(115 * 40); });
    // One idle frame plus eight walk frames, however long the preview runs.
    expect(encodes.mock.calls.length).toBeLessThanOrEqual(9);
    // Drawn on CPU-backed canvases: a GPU-backed one would read every export back through the GPU process.
    expect(contexts.length).toBeGreaterThan(0);
    for (const [kind, options] of contexts) {
      expect(kind).toBe('2d');
      expect(options).toMatchObject({ willReadFrequently: true });
    }
  });

  it('a portrait handed an equal appearance object on every HUD refresh is not redrawn', () => {
    const appearance = { ...DEFAULT_APPEARANCE, outfitColor: 4 };
    const view = render(<PlayerPortrait appearance={{ ...appearance }} />);
    const first = encodes.mock.calls.length;
    for (let i = 0; i < 20; i += 1) view.rerender(<PlayerPortrait appearance={{ ...appearance }} />);
    expect(encodes.mock.calls.length).toBe(first);
    expect(first).toBeLessThanOrEqual(1);
  });
});
