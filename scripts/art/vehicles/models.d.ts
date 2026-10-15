import type { Group } from 'three';
/** Phase 6 vehicle models (nose toward +X, centred, wheels on y = 0; meshes tagged `userData.layer`: body, detail, light). */
export const VEHICLE_MODELS: Readonly<Record<'compact' | 'sedan' | 'suv' | 'van' | 'bus', () => Group>>;
export function busStop(): Group;
