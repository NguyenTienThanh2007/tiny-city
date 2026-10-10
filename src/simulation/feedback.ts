import type { CityRejectionReason } from '@tiny-city/simulation';

export const rejectionFeedback: Record<CityRejectionReason, string> = {
  'invalid-building-type': 'Choose a building from the catalog.',
  'invalid-position': 'Choose a tile on the map.',
  'out-of-bounds': 'The entire footprint must fit inside the map.',
  'blocked-tile': 'Water tiles cannot be built on.',
  'occupied-tile': 'That footprint overlaps a building or road.',
  'road-required': 'This building must touch a road along one of its edges.',
  'insufficient-funds': 'Not enough funds to complete that edit.',
  'invalid-name': 'The building name must not be empty.',
  'building-not-found': 'That building is no longer in the city.',
  'building-in-use': 'This building is referenced by a resident schedule.',
  'road-already-exists': 'There is already a road on that tile.',
  'road-not-found': 'There is no road on that tile.',
  'duplicate-road-edit': 'The road edit contains the same tile twice.',
  'conflicting-road-edit': 'A road cannot be added and removed in the same edit.',
  'empty-road-edit': 'Choose a road tile to edit.',
  'state-limit-reached': 'The city has reached its edit limit.',
  'unchanged-position': 'Choose a different open tile for this building.',
};
