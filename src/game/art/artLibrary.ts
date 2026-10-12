import { Assets, Spritesheet, Texture } from 'pixi.js';
import type { SpritesheetData } from 'pixi.js';
import { BUILDINGS } from '../../types';
import { indexManifest, validateManifest, type ArtAssetRecord, type ArtIndex, type ArtManifest } from './artManifest';

/**
 * Loads the baked Visual World 3.0 atlases once per page. Textures get mipmaps so the art stays clean when the
 * camera zooms out. Any failure (missing files, invalid manifest, no WebGL) resolves to null and the renderer keeps
 * its procedural vector art, so a broken asset can never block the game.
 */
export interface ArtLibrary {
  readonly index: ArtIndex;
  /** Texture for a frame name, or null when the frame is missing. */
  frame(name: string | undefined): Texture | null;
  /** Approximate GPU bytes of the atlas pages (with mipmaps). */
  readonly textureBytes: number;
}

export const ART_BASE = `${import.meta.env?.BASE_URL ?? '/'}art/vw3/`;
let pending: Promise<ArtLibrary | null> | null = null;
let loaded: ArtLibrary | null = null;

export function currentArt(): ArtLibrary | null { return loaded; }

export function loadArt(base = ART_BASE): Promise<ArtLibrary | null> {
  if (!pending) pending = load(base).then((library) => { loaded = library; return library; }).catch((error) => {
    console.warn('[tiny-city] baked art unavailable, using vector art', error);
    return null;
  });
  return pending;
}

async function load(base: string): Promise<ArtLibrary | null> {
  if (typeof fetch !== 'function') return null;
  const response = await fetch(`${base}manifest.json`);
  if (!response.ok) throw new Error(`manifest ${response.status}`);
  const manifest = await response.json() as ArtManifest;
  const footprints = Object.fromEntries(Object.entries(BUILDINGS).map(([kind, spec]) => [kind, { width: spec.width, height: spec.height }]));
  const errors = validateManifest(manifest, footprints);
  if (errors.length) throw new Error(`invalid art manifest: ${errors.join('; ')}`);
  const frames = new Map<string, Texture>();
  let textureBytes = 0;
  await Promise.all(manifest.sheets.map(async (sheet) => {
    const [data, image] = await Promise.all([
      fetch(`${base}${sheet.file}`).then((r) => { if (!r.ok) throw new Error(`${sheet.file} ${r.status}`); return r.json() as Promise<SpritesheetData>; }),
      Assets.load<Texture>({ src: `${base}${sheet.image}`, data: { autoGenerateMipmaps: true, scaleMode: 'linear' } }),
    ]);
    image.source.style.mipmapFilter = 'linear';
    image.source.style.maxAnisotropy = 4;
    const spritesheet = new Spritesheet(image, data);
    await spritesheet.parse();
    for (const [name, texture] of Object.entries(spritesheet.textures)) frames.set(name, texture);
    textureBytes += Math.round(sheet.width * sheet.height * 4 * 4 / 3);
  }));
  const index = indexManifest(manifest);
  return { index, textureBytes, frame: (name) => (name ? frames.get(name) ?? null : null) };
}

/** Test seam: forget the cached library (only used by unit tests). */
export function resetArtForTests(library: ArtLibrary | null = null): void {
  loaded = library;
  pending = library ? Promise.resolve(library) : null;
}

export type { ArtAssetRecord };
