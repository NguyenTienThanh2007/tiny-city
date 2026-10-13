// Free-standing landscaping and street furniture, anchored at their base point (scene origin = decor anchor).
import { PALETTE as P, broadleaf, cypress, palm, shrub, streetLamp, bench, planter, flowerbed, sphere, mat, rng } from '../lib/kit.js';

const at = (id, kind, variant, build, extra = {}) => ({ id, kind, variant, category: 'nature', front: 'S', footprint: { w: 1, d: 1 }, origin: 'base', build, ...extra });

export function natureAssets() {
  const list = [];
  ['round', 'deep', 'olive'].forEach((leaves, i) => list.push(at(`tree.broadleaf.${i}`, 'tree', i, (g) => broadleaf(g, 0, 0, rng(500 + i), { scale: 1.05, leaves }))));
  list.push(at('tree.blossom.0', 'tree', 3, (g) => broadleaf(g, 0, 0, rng(531), { scale: 0.95, leaves: 'blossom' })));
  list.push(at('tree.autumn.0', 'tree', 4, (g) => broadleaf(g, 0, 0, rng(547), { scale: 1.0, leaves: 'autumn' })));
  list.push(at('tree.cypress.0', 'tree', 5, (g) => { cypress(g, -0.05, 0, rng(561), { scale: 1.1 }); cypress(g, 0.09, 0.06, rng(562), { scale: 0.85 }); }));
  [0, 1, 2].forEach((i) => list.push(at(`tree.palm.${i}`, 'palm', i, (g) => palm(g, 0, 0, rng(600 + i * 7), { scale: 1.0 + i * 0.08, lean: 0.18 + i * 0.07 }))));
  [0, 1, 2].forEach((i) => list.push(at(`tree.shrub.${i}`, 'bush', i, (g) => {
    const r = rng(700 + i);
    shrub(g, 0, 0, r, { scale: 1.3, flowers: [null, P.coral, P.gold][i] });
    shrub(g, 0.1, 0.05, r, { scale: 0.9 });
  })));
  [0, 1, 2].forEach((i) => list.push(at(`prop.flowers.${i}`, 'flowers', i, (g) => {
    const r = rng(800 + i);
    const palette = [[P.gold, P.ivory], [P.coral, P.gold], [0xb9a3e3, P.ivory]][i];
    for (let n = 0; n < 18; n += 1) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.14;
      sphere(g, Math.cos(a) * d, 0.015, Math.sin(a) * d * 0.8, 0.022, mat(r() < 0.5 ? 0x5f9654 : 0x6fa95e, { rough: 1 }), 0);
      sphere(g, Math.cos(a) * d, 0.035, Math.sin(a) * d * 0.8, 0.013, mat(palette[n % 2], { rough: 0.6 }), 0);
    }
  }, { shadow: false })));
  list.push(at('prop.lamp.0', 'lamp', 0, (g) => streetLamp(g, 0, 0)));
  list.push(at('prop.bench.x', 'bench', 0, (g) => bench(g, 0, 0, 'x')));
  list.push(at('prop.bench.z', 'bench', 1, (g) => bench(g, 0, 0, 'z')));
  list.push(at('prop.planter.0', 'planter', 0, (g) => planter(g, -0.12, -0.06, 0.24, 0.12, rng(901), { box: P.stone, h: 0.08 })));
  list.push(at('prop.bed.0', 'flowerbed', 0, (g) => flowerbed(g, -0.2, -0.12, 0.4, 0.24, rng(911)), { shadow: false }));
  return list;
}
