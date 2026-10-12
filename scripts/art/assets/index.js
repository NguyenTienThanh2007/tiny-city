// Registry of every baked asset. Each entry: { id, kind, category, variant, front, footprint, build(group) }.
import { villaAssets } from './villa.js';
import { townhouseAssets } from './townhouse.js';
import { apartmentAssets } from './apartment.js';
import { parkAssets } from './park.js';
import { natureAssets } from './nature.js';
import { roadAssets } from './roads.js';

export function allAssets() {
  return [
    ...[...villaAssets(), ...townhouseAssets(), ...apartmentAssets(), ...parkAssets()].map((asset) => ({ category: 'building', ...asset })),
    ...natureAssets(),
    ...roadAssets(),
  ];
}
