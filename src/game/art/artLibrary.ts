import { Assets, Spritesheet, Texture } from 'pixi.js';
import type { SpritesheetData } from 'pixi.js';
import { BUILDINGS } from '../../types';
import { indexManifest, validateManifest, type ArtAssetRecord, type ArtIndex, type ArtManifest } from './artManifest';
import { buildHitMask, hitMask, type HitMask } from './hitMask';

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
  /**
   * Alpha hit test for a building colour frame at a world-px offset from the frame's top-left. Returns null when
   * no mask exists (e.g. pixel data unavailable), so callers fall back to geometric picking.
   */
  hit(name: string | undefined, x: number, y: number): boolean | null;
  /** Atlas image and rectangle of a frame (texture px), for drawing outside Pixi (Character Creator canvas). */
  source(name: string): FrameSource | null;
}
export interface FrameSource {
  readonly image: CanvasImageSource;
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  /** Anchor in texture px from the frame's top-left. */
  readonly ax: number; readonly ay: number;
  /** Texture px per world px. */
  readonly resolution: number;
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
  const masks = new Map<string, HitMask>();
  const sources = new Map<string, FrameSource>();
  const buildingFrames = new Set(Object.values(manifest.assets).filter((asset) => asset.category === 'building' && asset.color).map((asset) => asset.color!));
  let textureBytes = 0;
  await Promise.all([...manifest.sheets, ...(manifest.characters?.sheets ?? [])].map(async (sheet) => {
    const [data, image] = await Promise.all([
      fetch(`${base}${sheet.file}`).then((r) => { if (!r.ok) throw new Error(`${sheet.file} ${r.status}`); return r.json() as Promise<SpritesheetData>; }),
      Assets.load<Texture>({ src: `${base}${sheet.image}`, data: { autoGenerateMipmaps: true, scaleMode: 'linear' } }),
    ]);
    image.source.style.mipmapFilter = 'linear';
    image.source.style.maxAnisotropy = 4;
    const spritesheet = new Spritesheet(image, data);
    await spritesheet.parse();
    for (const [name, texture] of Object.entries(spritesheet.textures)) frames.set(name, texture);
    const resource = image.source.resource as CanvasImageSource | undefined;
    const pageResolution = Number(data.meta.scale) || 1;
    if (resource && sheet.file.startsWith('characters-')) {
      for (const [name, entry] of Object.entries(data.frames)) {
        const f = entry.frame, anchor = (entry as { anchor?: { x: number; y: number } }).anchor ?? { x: 0, y: 0 };
        sources.set(name, { image: resource, x: f.x, y: f.y, w: f.w, h: f.h, ax: anchor.x * f.w, ay: anchor.y * f.h, resolution: pageResolution });
      }
    }
    const wanted = Object.entries(data.frames).filter(([name]) => buildingFrames.has(name));
    if (wanted.length) {
      const rgba = readPixels(image, sheet.width, sheet.height);
      const resolution = Number(data.meta.scale) || 1;
      if (rgba) for (const [name, entry] of wanted) masks.set(name, buildHitMask(rgba, sheet.width, entry.frame, resolution));
    }
    textureBytes += Math.round(sheet.width * sheet.height * 4 * 4 / 3);
  }));
  const index = indexManifest(manifest);
  return { index, textureBytes, frame: (name) => (name ? frames.get(name) ?? null : null),
    source: (name) => sources.get(name) ?? null,
    hit: (name, x, y) => { const mask = name ? masks.get(name) : undefined; return mask ? hitMask(mask, x, y) : null; } };
}

/** RGBA pixels of a loaded atlas image (once per page); null where the platform cannot read them back. */
function readPixels(image: Texture, width: number, height: number): Uint8ClampedArray | null {
  try {
    const resource = image.source.resource as CanvasImageSource | undefined;
    if (!resource || typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(resource, 0, 0);
    return ctx.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  }
}

/** Test seam: forget the cached library (only used by unit tests). */
export function resetArtForTests(library: ArtLibrary | null = null): void {
  loaded = library;
  pending = library ? Promise.resolve(library) : null;
}

export type { ArtAssetRecord };
