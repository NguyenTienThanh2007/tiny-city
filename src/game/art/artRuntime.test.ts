import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { initialCity } from '../../data/initialCity';
import { toCityPlan } from '../../simulation/cityAdapter';
import { DecorLayer } from '../decorLayer';
import { resetArtForTests, type ArtLibrary } from './artLibrary';
import { indexManifest, type ArtManifest } from './artManifest';

const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../../public/art/vw3/manifest.json'), 'utf8')) as ArtManifest;
/** A library whose every manifest frame resolves to a shared placeholder texture (no GPU needed). */
function fakeLibrary(missing: (name: string) => boolean = () => false): ArtLibrary {
  return { index: indexManifest(manifest), textureBytes: 0, frame: (name) => (name && !missing(name) ? Texture.WHITE : null), hit: () => null, source: () => null };
}

afterEach(() => resetArtForTests(null));

describe('decor layer with baked art', () => {
  const plan = toCityPlan(initialCity);

  it('uses baked sprites for trees, palms, shrubs and lamps and adds their ground shadows', () => {
    resetArtForTests(fakeLibrary());
    const scene = new Container(), ground = new Container(), shadows = new Container();
    const layer = new DecorLayer(scene, ground, null, shadows);
    layer.rebuild(plan);
    const tall = scene.children.filter((child) => child.label === 'decor');
    expect(tall.length).toBeGreaterThan(0);
    for (const item of tall) expect((item as Container).children[0]).toBeInstanceOf(Sprite);
    expect(shadows.children.length).toBeGreaterThan(0);
    // Rebuilding replaces (never accumulates) sprites and shadows.
    const counts = [scene.children.length, shadows.children.length, ground.children.length];
    layer.rebuild(plan);
    expect([scene.children.length, shadows.children.length, ground.children.length]).toEqual(counts);
    layer.destroy();
    expect(shadows.children.length).toBe(0);
  });

  it('falls back to vector art per item when a frame is missing, and entirely without a library', () => {
    resetArtForTests(fakeLibrary((name) => name.startsWith('tree.palm')));
    const scene = new Container();
    const layer = new DecorLayer(scene, new Container(), null, new Container());
    layer.rebuild(plan);
    const bodies = scene.children.filter((child) => child.label === 'decor').map((item) => (item as Container).children[0]);
    expect(bodies.some((body) => body instanceof Sprite)).toBe(true);
    layer.destroy();

    resetArtForTests(null);
    const vectorScene = new Container();
    const vector = new DecorLayer(vectorScene, new Container(), null, new Container());
    vector.rebuild(plan);
    const vectorBodies = vectorScene.children.filter((child) => child.label === 'decor').map((item) => (item as Container).children[0]);
    expect(vectorBodies.length).toBeGreaterThan(0);
    expect(vectorBodies.every((body) => body instanceof Graphics)).toBe(true);
    vector.destroy();
  });
});

describe('building selection with baked art', () => {
  it('selects a building by clicking high on its art, above the legacy clickable box', async () => {
    const { buildingAtPoint } = await import('../CityViewport');
    const { iso } = await import('../mapGeometry');
    const villa = initialCity.buildings.find((building) => building.id === 'villa-seed-1')!;
    const center = iso(villa.x + 1, villa.y + 1);
    // 90 px above the centre is well over the villa's legacy box (lift 30 + cap 8) and over empty ground.
    const high = { x: center.x, y: center.y - 90 };
    expect(buildingAtPoint(initialCity, high)?.id).not.toBe(villa.id);
    // With art whose mask says that pixel is opaque for this villa only, the click selects it.
    const library = fakeLibrary();
    const villaFrames = new Set(Object.values(library.index.buildings.get('villa') ?? []).map((asset) => asset.color));
    resetArtForTests({ ...library, hit: (name) => (villaFrames.has(name) ? true : false) });
    const hit = buildingAtPoint({ ...initialCity, buildings: [villa] }, high);
    expect(hit?.id).toBe(villa.id);
    // An empty mask pixel never steals the click from the ground.
    resetArtForTests({ ...library, hit: () => false });
    expect(buildingAtPoint({ ...initialCity, buildings: [villa] }, high)).toBeUndefined();
  });
});

describe('decor level of detail', () => {
  it('stops rendering small decor and decor shadows when zoomed far out, without touching placement hiding', async () => {
    const { LOD_SCALE } = await import('../decorLayer');
    resetArtForTests(fakeLibrary());
    const scene = new Container(), shadows = new Container();
    const layer = new DecorLayer(scene, new Container(), null, shadows);
    layer.rebuild(toCityPlan(initialCity));
    const items = scene.children.filter((child) => child.label === 'decor');
    layer.setDetail(LOD_SCALE / 2);
    expect(shadows.renderable).toBe(false);
    const hidden = items.filter((item) => !item.renderable);
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.length).toBeLessThan(items.length); // trees, palms and lamps stay
    expect(items.every((item) => item.visible)).toBe(true);
    layer.setDetail(LOD_SCALE * 2);
    expect(shadows.renderable).toBe(true);
    expect(items.every((item) => item.renderable)).toBe(true);
    layer.destroy();
  });
});
