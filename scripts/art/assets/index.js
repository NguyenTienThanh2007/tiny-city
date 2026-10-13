// Registry of every baked asset. Each entry: { id, kind, category, variant, front, footprint, build(group) }.
import { villaAssets } from './villa.js';
import { duplexAssets } from './duplex.js';
import { townhouseAssets } from './townhouse.js';
import { apartmentAssets } from './apartment.js';
import { parkAssets } from './park.js';
import { clubhouseAssets } from './clubhouse.js';
import { poolAssets } from './pool.js';
import { mallAssets } from './mall.js';
import { officeAssets } from './office.js';
import { natureAssets } from './nature.js';
import { roadAssets } from './roads.js';
import { lmVillaAssets } from './lm-villas.js';
import { lmResidentialAssets } from './lm-residential.js';
import { lmCivicAssets } from './lm-civic.js';
import { collectionAssets } from './collections.js';

export function allAssets() {
  return [
    ...[...villaAssets(), ...duplexAssets(), ...townhouseAssets(), ...apartmentAssets(), ...parkAssets(),
      ...clubhouseAssets(), ...poolAssets(), ...mallAssets(), ...officeAssets(),
      // Visual World 3.1 architecture collections.
      ...lmVillaAssets(), ...lmResidentialAssets(), ...lmCivicAssets(), ...collectionAssets()].map((asset) => ({ category: 'building', ...asset })),
    ...natureAssets(),
    ...roadAssets(),
  ];
}
