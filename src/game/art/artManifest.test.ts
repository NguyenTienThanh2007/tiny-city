import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILDINGS, type BuildingKind } from '../../types';
import { buildingLift } from '../buildingArt';
import { BAKED_BUILDING_KINDS, indexManifest, roadMask, selectBuildingAsset, selectDecorAsset, selectRoadAsset, validateManifest, type ArtManifest } from './artManifest';
import { buildHitMask, hitMask } from './hitMask';

const dir = resolve(__dirname, '../../../public/art/vw3');
const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as ArtManifest;
const footprints = Object.fromEntries(Object.entries(BUILDINGS).map(([kind, spec]) => [kind, { width: spec.width, height: spec.height }]));
const index = indexManifest(manifest);
const NO_ROAD = { north: false, south: false, east: false, west: false };

describe('baked art manifest (public/art/vw3)', () => {
  it('is valid and matches the simulation catalog footprints', () => {
    expect(validateManifest(manifest, footprints)).toEqual([]);
  });

  it('references only frames that exist in its atlas pages, with colour anchors at the drawn frame', () => {
    const frames = new Map<string, { frame: { w: number; h: number }; anchor: { x: number; y: number } }>();
    for (const sheet of manifest.sheets) {
      const data = JSON.parse(readFileSync(resolve(dir, sheet.file), 'utf8'));
      expect(data.meta.image).toBe(sheet.image);
      // Full-resolution sheets hold colour frames; half-resolution "soft" sheets hold shadows and night glow.
      expect(Number(data.meta.scale)).toBe(sheet.scale ?? manifest.resolution);
      for (const [name, frame] of Object.entries(data.frames)) {
        frames.set(name, frame as never);
        if (name.endsWith('#color')) expect(Number(data.meta.scale), name).toBe(manifest.resolution);
      }
    }
    for (const [id, asset] of Object.entries(manifest.assets)) {
      for (const pass of ['color', 'shadow', 'emissive'] as const) {
        const name = asset[pass];
        if (!name) continue;
        const frame = frames.get(name);
        expect(frame, `${id} ${pass}`).toBeDefined();
        expect(frame!.frame.w).toBeGreaterThan(0);
        // Colour anchors (the footprint origin / base point) lie within or right next to the drawn frame; trimmed
        // shadow and glow frames may be far from it, since only their cast or lit pixels are kept.
        if (pass === 'color') {
          expect(frame!.anchor.x, id).toBeGreaterThan(-0.5); expect(frame!.anchor.x, id).toBeLessThan(1.5);
          expect(frame!.anchor.y, id).toBeGreaterThan(-0.5); expect(frame!.anchor.y, id).toBeLessThan(1.5);
        }
      }
    }
  });

  it('ships every catalog building type (both facings except parks), all 16 road masks and a plaza tile', () => {
    expect([...BAKED_BUILDING_KINDS].sort()).toEqual(Object.keys(BUILDINGS).sort());
    for (const kind of BAKED_BUILDING_KINDS) {
      const list = index.buildings.get(kind) ?? [];
      expect(list.length, kind).toBeGreaterThanOrEqual(kind === 'pool' || kind === 'mall' ? 2 : 3);
      if (kind !== 'park') expect(new Set(list.map((asset) => asset.front))).toEqual(new Set(['S', 'E']));
    }
    for (let mask = 0; mask < 16; mask += 1) expect(index.roads.get(mask)?.color).toBeDefined();
    expect(index.plaza?.color).toBeDefined();
  });

  it('records each building art height for labels and markers, at least its legacy clickable height', () => {
    for (const [id, asset] of Object.entries(manifest.assets)) {
      if (asset.category !== 'building') continue;
      expect(asset.heightPx, id).toBeGreaterThan(0);
      // Tall art is clickable through alpha picking; heights stay in a sane range for the camera framing.
      expect(asset.heightPx!, id).toBeLessThan(220);
      if (asset.kind !== 'park' && asset.kind !== 'pool') expect(asset.heightPx!, id).toBeGreaterThanOrEqual(buildingLift({ kind: asset.kind as BuildingKind }, 1) * 0.6);
    }
  });
});

describe('art selection rules', () => {
  it('pick the same variant for the same building every time (save/reload and undo safe)', () => {
    for (const kind of BAKED_BUILDING_KINDS) for (let i = 0; i < 30; i += 1) {
      expect(selectBuildingAsset(index, kind, `b-${i}`, NO_ROAD)).toBe(selectBuildingAsset(index, kind, `b-${i}`, NO_ROAD));
    }
  });

  it('vary repeated buildings and face the street', () => {
    const villas = Array.from({ length: 24 }, (_, i) => selectBuildingAsset(index, 'villa', `villa-seed-${i}`, NO_ROAD)!);
    expect(new Set(villas.map((asset) => asset.variant)).size).toBeGreaterThanOrEqual(3);
    expect(selectBuildingAsset(index, 'villa', 'x', { ...NO_ROAD, east: true })!.front).toBe('E');
    expect(selectBuildingAsset(index, 'villa', 'x', { ...NO_ROAD, east: true, south: true })!.front).toBe('S');
    expect(selectBuildingAsset(index, 'villa', 'x', { ...NO_ROAD, north: true })!.front).toBe('S');
  });

  it('fall back (null) for unknown kinds and decor, so the vector renderer draws them', () => {
    expect(selectBuildingAsset(index, 'lighthouse', 'id', NO_ROAD)).toBeNull();
    expect(selectDecorAsset(index, 'fountain', 0)).toBeNull();
    for (const kind of ['tree', 'accent', 'streetTree', 'palm', 'bush', 'flowers', 'stones', 'grass', 'lamp', 'bench', 'bin', 'bikes', 'planter']) {
      for (let variant = 0; variant < 8; variant += 1) expect(selectDecorAsset(index, kind, variant)?.color, `${kind} ${variant}`).toBeDefined();
    }
  });

  it('uses the plaza tile only where the road widens into an area', () => {
    const block = new Set<string>();
    for (let y = 0; y < 3; y += 1) for (let x = 0; x < 3; x += 1) block.add(`${x},${y}`);
    const has = (x: number, y: number) => block.has(`${x},${y}`);
    expect(selectRoadAsset(index, has, 1, 1)).toBe(index.plaza);
    expect(selectRoadAsset(index, has, 0, 1)).toBe(index.roads.get(roadMask(has, 0, 1)));
    const cross = new Set(['5,4', '6,5', '5,6', '4,5', '5,5']);
    expect(selectRoadAsset(index, (x, y) => cross.has(`${x},${y}`), 5, 5)).toBe(index.roads.get(15));
  });

  it('builds world-pixel hit masks from atlas alpha and tests them', () => {
    // A 4×4 texture-px frame at (2, 1) on an 8-px-wide page, resolution 2: only its top-left texel block is solid.
    const page = new Uint8ClampedArray(8 * 6 * 4);
    page[(1 * 8 + 2) * 4 + 3] = 255;
    const mask = buildHitMask(page, 8, { x: 2, y: 1, w: 4, h: 4 }, 2);
    expect([mask.width, mask.height]).toEqual([2, 2]);
    expect(hitMask(mask, 0.5, 0.5)).toBe(true);
    expect(hitMask(mask, 1.5, 0.5)).toBe(false);
    expect(hitMask(mask, -1, 0)).toBe(false);
    expect(hitMask(mask, 5, 5)).toBe(false);
  });

  it('computes road masks from the four neighbours', () => {
    const roads = new Set(['5,4', '6,5', '5,6', '4,5', '5,5']);
    const has = (x: number, y: number) => roads.has(`${x},${y}`);
    expect(roadMask(has, 5, 5)).toBe(15);
    expect(roadMask(has, 5, 4)).toBe(4);
    expect(roadMask(has, 6, 5)).toBe(8);
    expect(roadMask(has, 9, 9)).toBe(0);
  });

  it('reports structural problems instead of throwing', () => {
    expect(validateManifest(null)).toEqual(['manifest is not an object']);
    const broken = { ...manifest, tile: { w: 64, h: 32 }, assets: { bad: { kind: 'villa', category: 'building', variant: 0, front: 'N', footprint: { w: 3, d: 3 } } } };
    const errors = validateManifest(broken, footprints);
    expect(errors.some((error) => error.includes('tile size'))).toBe(true);
    expect(errors.some((error) => error.includes('no color frame'))).toBe(true);
    expect(errors.some((error) => error.includes('invalid front'))).toBe(true);
    expect(errors.some((error) => error.includes('does not match the catalog'))).toBe(true);
  });
});
