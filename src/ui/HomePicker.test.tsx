import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import type { HomeOption, HousingSummary } from '@tiny-city/simulation';
import { HomePicker } from './LifePanel';

afterEach(cleanup);
const option = (buildingId: string, residents: number, current = false): HomeOption => {
  const occupied = residents + (current ? 1 : 0);
  return { buildingId, name: buildingId, capacity: 2, residents, occupied, freeRooms: Math.max(0, 2 - occupied),
    available: !current && occupied < 2, roadConnected: true, current };
};
const full: HousingSummary = { homes: 2, rooms: 4, residents: 3, occupied: 4, freeRooms: 0, playerRoomHeld: false };
const props = { selectedId: null, populationEnabled: true, welcome: true, projection: null, fresh: new Set<string>(), playerName: 'Mai',
  onWelcomeChange: () => {}, onSelect: () => {}, onConfirm: () => {}, onBack: () => {}, onBuildHome: () => {}, kindOf: () => 'villa' as const };

describe('home picker occupancy copy', () => {
  it('counts the player once in their own home', () => {
    render(<HomePicker {...props} purpose="move" housing={full} options={[option('Villa A', 1, true), option('Villa B', 2)]} />);
    expect(screen.getByRole('button', { name: /Villa A/ })).toHaveTextContent('2 of 2 rooms taken (incl. you)');
    expect(screen.getByRole('region', { name: 'No free home' })).toHaveTextContent('4 of 4 rooms taken in 2 homes');
  });

  it('moving home with nowhere free never claims the housed player is waiting for a held room', () => {
    render(<HomePicker {...props} purpose="move" housing={full} options={[option('Villa A', 1, true), option('Villa B', 2)]} />);
    const recovery = screen.getByRole('region', { name: 'No free home' });
    expect(recovery).toHaveTextContent('No other home has a free room');
    expect(recovery).toHaveTextContent('You keep your current home');
    expect(recovery).not.toHaveTextContent('kept free for');
    expect(recovery).not.toHaveTextContent('saved and waiting');
  });

  it('a waiting character still gets the held-room explanation', () => {
    render(<HomePicker {...props} purpose="create" housing={{ ...full, residents: 4, playerRoomHeld: true }} options={[option('Villa A', 2), option('Villa B', 2)]} />);
    const recovery = screen.getByRole('region', { name: 'No free home' });
    expect(recovery).toHaveTextContent('Every home is full right now');
    expect(recovery).toHaveTextContent('one room is kept free for Mai');
    expect(recovery).toHaveTextContent('Mai is saved and waiting');
  });
});
