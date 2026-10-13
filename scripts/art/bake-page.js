// Browser entry for the bake: builds assets with the kit, renders their passes and packs atlases.
import * as THREE from 'three';
import { createStage, trim, pack } from './lib/stage.js';
import { allAssets } from './assets/index.js';
import { applyWorldUVs } from './lib/textures.js';
import { HEIGHT_PX_PER_UNIT } from './lib/projection.js';

// Three's SimplexNoise (used by GTAO's denoise noise texture) seeds itself from Math.random. A fixed seed makes
// every bake byte-identical, so atlas diffs in git only ever show real art changes.
{
  let seed = 0x7c17a5;
  Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const RESOLUTION = 2;
const stage = createStage({ resolution: RESOLUTION });
/** Mirror across the x = z diagonal: turns a south-facing design into an east-facing one. */
const SWAP = new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);

function instantiate(asset) {
  const inner = new THREE.Group();
  asset.build(inner);
  if (asset.front !== 'E' || asset.tile) return inner;
  const outer = new THREE.Group();
  outer.matrixAutoUpdate = false;
  outer.matrix.copy(SWAP);
  outer.add(inner);
  return outer;
}

function render(asset, index) {
  const object = instantiate(asset);
  applyWorldUVs(object);
  const passes = asset.tile ? stage.bakeTile(object) : stage.bake(object, { seed: index + 1, shadow: asset.shadow !== false, emissive: asset.emissive !== false });
  object.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  return passes;
}

// Lossy WebP (q 0.92) keeps edges and alpha clean at a fraction of the PNG size.
const toUrl = (canvas) => canvas.toDataURL('image/webp', 0.92);

window.TC = {
  ids: () => allAssets().map((asset) => asset.id),
  /** Raw passes for one asset (for art review). */
  preview(id) {
    const assets = allAssets();
    const index = assets.findIndex((asset) => asset.id === id);
    const passes = render(assets[index], index);
    delete passes.top;
    // Previews are PNG at full resolution (half-resolution shadows are upscaled so review sheets line up).
    const full = (value) => {
      if (!value.half) return value;
      const c = document.createElement('canvas'); c.width = value.canvas.width * 2; c.height = value.canvas.height * 2;
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(value.canvas, 0, 0, c.width, c.height);
      return { canvas: c, anchor: { x: value.anchor.x * 2, y: value.anchor.y * 2 } };
    };
    return Object.fromEntries(Object.entries(passes).map(([pass, value]) => { const f = full(value); return [pass, { url: f.canvas.toDataURL('image/png'), anchor: f.anchor }]; }));
  },
  /** Bakes the selected (or all) assets of one atlas group into pages plus manifest entries. */
  bake(filter = null) {
    const entries = [];
    const halfEntries = [];
    const manifest = {};
    allAssets().forEach((asset, index) => {
      if (filter && !filter.some((prefix) => asset.id.startsWith(prefix))) return;
      const passes = render(asset, index);
      const record = { kind: asset.kind, category: asset.category, variant: asset.variant ?? 0, front: asset.front ?? 'S', footprint: asset.footprint ?? { w: 1, d: 1 } };
      if (asset.mask !== undefined) record.mask = asset.mask;
      if (asset.plaza) record.plaza = true;
      if (passes.top !== undefined && asset.category === 'building') record.heightPx = Math.round(passes.top * HEIGHT_PX_PER_UNIT * 10) / 10;
      for (const [pass, value] of Object.entries(passes)) {
        if (pass === 'top') continue;
        const trimmed = trim(value);
        if (!trimmed) continue;
        const name = `${asset.id}#${pass}`;
        (value.half ? halfEntries : entries).push({ name, ...trimmed });
        record[pass] = name;
      }
      manifest[asset.id] = record;
    });
    const out = (list, scale, suffix) => (list.length ? pack(list) : []).map((page) => ({ index: page.index, suffix, scale, url: toUrl(page.canvas), width: page.canvas.width, height: page.canvas.height, frames: page.frames }));
    const pages = [...out(entries, RESOLUTION, ''), ...out(halfEntries, RESOLUTION / 2, '-soft')];
    return { pages, manifest, resolution: RESOLUTION };
  },
};
window.TC_READY = true;
