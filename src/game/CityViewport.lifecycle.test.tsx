import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialCity } from '../data/initialCity';
import { createCityWorld } from '../simulation/cityAdapter';
import CityViewport from './CityViewport';

const mocks = vi.hoisted(() => ({ init: vi.fn<() => Promise<void>>() }));
vi.mock('pixi.js', () => ({
  Application: class { init = mocks.init; },
  Container: class {}, Graphics: class {}, Text: class {},
}));

describe('renderer startup failure', () => {
  it('reports failed initialization once under StrictMode instead of leaving an empty map', async () => {
    mocks.init.mockRejectedValue(new Error('WebGL unavailable'));
    render(<StrictMode><CityViewport city={initialCity} world={createCityWorld(initialCity)}
      tool="select" selectedBuildingId={null} movingBuildingId={null}
      onSimulationFrame={vi.fn()} onSelectBuilding={vi.fn()} onPlaceBuilding={vi.fn()}
      onBeginMoveBuilding={vi.fn()} onMoveBuilding={vi.fn()} onAddRoad={vi.fn()}
      onBulldoze={vi.fn()} onCameraFootprintChange={vi.fn()} /></StrictMode>);
    expect(await screen.findByRole('alert')).toHaveTextContent('renderer could not start');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(mocks.init).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
  });
});
