import { writeFile } from 'node:fs/promises';
import { BUILDING_CATALOG } from '@tiny-city/simulation';
import { LIMITS } from '@tiny-city/ai-architect';
await writeFile(new URL('../packages/ai-architect/dist/catalog.json', import.meta.url), JSON.stringify({contractVersion:1,catalog:BUILDING_CATALOG,limits:LIMITS}));
