import { architectureModel, classicModel, isCollectionId, modelsFor } from '@tiny-city/ai-architect';
import type { ArchitectureCollectionId, BuildingDesign } from '@tiny-city/ai-architect';
import type { WorldState } from '@tiny-city/simulation';
import { BUILDINGS, type Building, type BuildingKind } from '../types';
import { hashString } from './npcMotion';

/**
 * Visual World 3.1: frontend rules for a building's architectural design. Pure functions only, so the Build UI,
 * the placement preview, construction, the renderer and saves all agree on which model a building gets.
 */

/** What the player picked for a building type: a specific model, or `model: null` for a varied mix of a collection. */
export interface DesignChoice { readonly collection: ArchitectureCollectionId; readonly model: string | null }
export type DesignChoices = Readonly<Partial<Record<BuildingKind, DesignChoice>>>;
/** The default keeps the original look: the classic variant chosen from the building ID, exactly as before 3.1. */
export const DEFAULT_CHOICE: DesignChoice = Object.freeze({ collection: 'classic', model: null });

const ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/** Keeps a design with a sound shape (unknown model IDs stay, so newer saves survive); drops anything malformed. */
export function sanitizeDesign(value: unknown): BuildingDesign | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'collection' && key !== 'model')) return undefined;
  const { collection, model } = record;
  if (typeof collection !== 'string' || typeof model !== 'string' || collection.length > 48 || model.length > 96 ||
      !ID.test(collection) || !ID.test(model)) return undefined;
  return { collection: collection as ArchitectureCollectionId, model };
}

/** The classic model a building without a design has always shown (the 3.0B variant from its ID). */
export function legacyDesign(kind: BuildingKind, id: string): BuildingDesign {
  const models = modelsFor(kind, 'classic');
  const model = classicModel(kind, hashString(`vw3:${kind}:${id}`) % models.length) ?? models[0]!;
  return { collection: 'classic', model: model.id };
}

/** The concrete design a choice gives the building with this ID (a mix hashes the ID, like the legacy look). */
export function resolveChoice(kind: BuildingKind, choice: DesignChoice | undefined, id: string): BuildingDesign {
  const { collection, model } = choice ?? DEFAULT_CHOICE;
  if (model) {
    const found = architectureModel(model);
    if (found && found.buildingType === kind && found.status === 'available') return { collection: found.collection, model: found.id };
  }
  if (collection === 'classic' || !isCollectionId(collection)) return legacyDesign(kind, id);
  const models = modelsFor(kind, collection, true);
  if (!models.length) return legacyDesign(kind, id);
  return { collection, model: models[hashString(`vw31:${kind}:${collection}:${id}`) % models.length]!.id };
}

/** The design a building is drawn with: its saved design, or the legacy classic look. */
export function designOf(building: Pick<Building, 'id' | 'kind' | 'design'>): BuildingDesign {
  return building.design ?? legacyDesign(building.kind, building.id);
}

/** The ID the simulation will give the next building (mirrors the `city.build` cursor in cityCommands.ts). */
export function predictBuildingId(world: Pick<WorldState, 'nextBuildingId' | 'plan'>): string {
  const ids = new Set(world.plan.buildings.map((building) => building.id));
  let cursor = world.nextBuildingId;
  while (ids.has(`building-${cursor}`)) cursor += 1;
  return `building-${cursor}`;
}

/** Baked catalog thumbnail for a model (written by the art bake). */
export const thumbnailUrl = (modelId: string) => `${import.meta.env?.BASE_URL ?? '/'}art/vw3/thumbs/${modelId}.webp`;

/** Short human label, e.g. "Luxury Minimalist · Glass Pavilion Villa". */
export function designLabel(design: BuildingDesign): string {
  const model = architectureModel(design.model);
  return model ? model.name : design.model;
}

const CHOICES_KEY = 'tiny-city-design-choices-v1';
/** The viewer's remembered model per building type (a per-viewer convenience; never part of the city save). */
export function readDesignChoices(): DesignChoices {
  try {
    const raw = JSON.parse(localStorage.getItem(CHOICES_KEY) ?? '{}') as Record<string, unknown>;
    const choices: Partial<Record<BuildingKind, DesignChoice>> = {};
    for (const [kind, value] of Object.entries(raw ?? {})) {
      if (!value || typeof value !== 'object') continue;
      const { collection, model } = value as Record<string, unknown>;
      if (!Object.hasOwn(BUILDINGS, kind) || !isCollectionId(collection)) continue;
      const found = typeof model === 'string' ? architectureModel(model) : undefined;
      if (model !== null && !(found && found.buildingType === kind && found.collection === collection && found.status === 'available')) continue;
      choices[kind as BuildingKind] = { collection, model: found ? found.id : null };
    }
    return choices;
  } catch {
    return {};
  }
}
export function writeDesignChoices(choices: DesignChoices): void {
  try { localStorage.setItem(CHOICES_KEY, JSON.stringify(choices)); } catch { /* storage unavailable: choices last for this visit */ }
}

/** District cohesion: the collection becomes the choice (varied mix, or its single model) for every type it covers. */
export function applyCollectionToAll(choices: DesignChoices, collection: ArchitectureCollectionId): DesignChoices {
  const next: Partial<Record<BuildingKind, DesignChoice>> = { ...choices };
  for (const kind of Object.keys(BUILDINGS) as BuildingKind[]) {
    const models = modelsFor(kind, collection, true);
    if (models.length) next[kind] = { collection, model: models.length === 1 ? models[0]!.id : null };
  }
  return next;
}
