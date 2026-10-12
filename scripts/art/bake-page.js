// Browser entry for the bake: builds assets with the kit, renders their passes and packs atlases.
import * as THREE from 'three';
import { createStage, trim, pack } from './lib/stage.js';
import { allAssets } from './assets/index.js';

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
  const passes = asset.tile ? stage.bakeTile(object) : stage.bake(object, { seed: index + 1, shadow: asset.shadow !== false, emissive: asset.emissive !== false });
  object.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  return passes;
}

const toUrl = (canvas) => canvas.toDataURL('image/png');

window.TC = {
  ids: () => allAssets().map((asset) => asset.id),
  /** Raw passes for one asset (for art review). */
  preview(id) {
    const assets = allAssets();
    const index = assets.findIndex((asset) => asset.id === id);
    const passes = render(assets[index], index);
    return Object.fromEntries(Object.entries(passes).map(([pass, value]) => [pass, { url: toUrl(value.canvas), anchor: value.anchor }]));
  },
  /** Bakes the selected (or all) assets of one atlas group into pages plus manifest entries. */
  bake(filter = null) {
    const entries = [];
    const manifest = {};
    allAssets().forEach((asset, index) => {
      if (filter && !filter.some((prefix) => asset.id.startsWith(prefix))) return;
      const passes = render(asset, index);
      const record = { kind: asset.kind, category: asset.category, variant: asset.variant ?? 0, front: asset.front ?? 'S', footprint: asset.footprint ?? { w: 1, d: 1 } };
      if (asset.mask !== undefined) record.mask = asset.mask;
      for (const [pass, value] of Object.entries(passes)) {
        const trimmed = trim(value);
        if (!trimmed) continue;
        const name = `${asset.id}#${pass}`;
        entries.push({ name, ...trimmed });
        record[pass] = name;
      }
      manifest[asset.id] = record;
    });
    const pages = pack(entries).map((page) => ({ index: page.index, url: toUrl(page.canvas), width: page.canvas.width, height: page.canvas.height, frames: page.frames }));
    return { pages, manifest, resolution: RESOLUTION };
  },
};
window.TC_READY = true;
