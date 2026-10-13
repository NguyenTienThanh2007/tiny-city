import { writeFile } from 'node:fs/promises';
import { BUILDING_CATALOG } from '@tiny-city/simulation';
import { ARCHITECTURE_COLLECTIONS, ARCHITECTURE_MODELS, LIMITS } from '@tiny-city/ai-architect';
// Architecture (Visual World 3.1): selectable collections and models, so the API can list them for the provider.
const architecture = {
  collections: ARCHITECTURE_COLLECTIONS.map(({ id, name, nameVi }) => ({ id, name, nameVi })),
  models: ARCHITECTURE_MODELS.filter((model) => model.status === 'available').map(({ id, collection, buildingType, name, nameVi }) => ({ id, collection, buildingType, name, nameVi })),
};
await writeFile(new URL('../packages/ai-architect/dist/catalog.json', import.meta.url), JSON.stringify({contractVersion:1,catalog:BUILDING_CATALOG,limits:LIMITS,architecture}));
