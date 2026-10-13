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
  return { index: indexManifest(manifest), textureBytes: 0, frame: (name) => (name && !missing(name) ? Texture.WHITE : null) };
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
