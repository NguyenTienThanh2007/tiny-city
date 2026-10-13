import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILDINGS, type BuildingKind } from '../../types';
import { buildingLift, roofCapHeight } from '../buildingArt';
import { BAKED_BUILDING_KINDS, indexManifest, roadMask, selectBuildingAsset, selectDecorAsset, validateManifest, type ArtManifest } from './artManifest';

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
      expect(Number(data.meta.scale)).toBe(manifest.resolution);
      for (const [name, frame] of Object.entries(data.frames)) frames.set(name, frame as never);
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

  it('ships every slice building in both facings and all 16 road masks', () => {
    for (const kind of BAKED_BUILDING_KINDS) {
      const list = index.buildings.get(kind) ?? [];
      expect(list.length, kind).toBeGreaterThanOrEqual(3);
      if (kind !== 'park') expect(new Set(list.map((asset) => asset.front))).toEqual(new Set(['S', 'E']));
    }
    for (let mask = 0; mask < 16; mask += 1) expect(index.roads.get(mask)?.color).toBeDefined();
  });

  it('keeps baked building art within the clickable roof height used for hit testing', () => {
    // Color frames are in texture px at `resolution`; the part above the footprint's north corner is the height.
    const frames = new Map<string, { frame: { h: number }; anchor: { y: number } }>();
    for (const sheet of manifest.sheets) for (const [name, frame] of Object.entries(JSON.parse(readFileSync(resolve(dir, sheet.file), 'utf8')).frames)) frames.set(name, frame as never);
    for (const [id, asset] of Object.entries(manifest.assets)) {
      if (asset.category !== 'building' || asset.kind === 'park') continue;
      const frame = frames.get(asset.color!)!;
      const above = frame.anchor.y * frame.frame.h / manifest.resolution; // world px above the north corner
      // Nothing may rise above the clickable cap at the footprint's north corner (the highest point of its hit box).
      const kind = asset.kind as BuildingKind;
      expect(above, id).toBeLessThanOrEqual(buildingLift({ kind }, 1) + roofCapHeight(kind));
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

  it('fall back (null) for kinds without baked art, so the vector renderer draws them', () => {
    const vectorOnly = (Object.keys(BUILDINGS) as BuildingKind[]).filter((kind) => !BAKED_BUILDING_KINDS.includes(kind));
    expect(vectorOnly.length).toBeGreaterThan(0);
    for (const kind of vectorOnly) expect(selectBuildingAsset(index, kind, 'id', NO_ROAD)).toBeNull();
    expect(selectDecorAsset(index, 'stones', 0)).toBeNull();
    expect(selectDecorAsset(index, 'tree', 3)?.color).toBeDefined();
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
