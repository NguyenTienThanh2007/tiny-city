// Free-standing landscaping and street furniture, anchored at their base point (scene origin = decor anchor).
import { PALETTE as P, broadleaf, cypress, palm, shrub, streetLamp, bench, planter, flowerbed, sphere, mat, rng, poplar, pine, fanPalm, bananaPlant, grassTuft, rock } from '../lib/kit.js';
import { bin, bikeRack, pottedPlant } from '../lib/props.js';

const at = (id, kind, variant, build, extra = {}) => ({ id, kind, variant, category: 'nature', front: 'S', footprint: { w: 1, d: 1 }, origin: 'base', build, ...extra });

export function natureAssets() {
  const list = [];
  // Mature trees (about 1.3–1.6 tiles tall). Variants stay deterministic through fixed seeds.
  ['round', 'deep', 'olive'].forEach((leaves, i) => list.push(at(`tree.broadleaf.${i}`, 'tree', i, (g) => broadleaf(g, 0, 0, rng(500 + i), { scale: 1.3 + i * 0.08, leaves }))));
  list.push(at('tree.blossom.0', 'tree', 3, (g) => broadleaf(g, 0, 0, rng(531), { scale: 1.15, leaves: 'blossom' })));
  list.push(at('tree.autumn.0', 'tree', 4, (g) => broadleaf(g, 0, 0, rng(547), { scale: 1.2, leaves: 'autumn' })));
  list.push(at('tree.cypress.0', 'tree', 5, (g) => { cypress(g, -0.06, 0, rng(561), { scale: 1.35 }); cypress(g, 0.1, 0.07, rng(562), { scale: 1.05 }); }));
  list.push(at('tree.jacaranda.0', 'tree', 6, (g) => broadleaf(g, 0, 0, rng(571), { scale: 1.25, leaves: 'jacaranda', spread: 1.15 })));
  list.push(at('tree.poplar.0', 'tree', 7, (g) => { poplar(g, -0.05, 0, rng(581), { scale: 1.2 }); poplar(g, 0.1, 0.08, rng(582), { scale: 1.0 }); }));
  list.push(at('tree.pine.0', 'tree', 8, (g) => pine(g, 0, 0, rng(591), { scale: 1.25 })));
  list.push(at('tree.lime.0', 'tree', 9, (g) => broadleaf(g, 0, 0, rng(597), { scale: 1.45, leaves: 'lime', spread: 1.2 })));
  [0, 1, 2].forEach((i) => list.push(at(`tree.palm.${i}`, 'palm', i, (g) => palm(g, 0, 0, rng(600 + i * 7), { scale: 1.25 + i * 0.1, lean: 0.18 + i * 0.07 }))));
  list.push(at('tree.fanpalm.0', 'palm', 3, (g) => fanPalm(g, 0, 0, rng(631), { scale: 1.4 })));
  [0, 1, 2].forEach((i) => list.push(at(`tree.shrub.${i}`, 'bush', i, (g) => {
    const r = rng(700 + i);
    shrub(g, 0, 0, r, { scale: 1.6, flowers: [null, 0xd94f8a, P.gold][i], color: i === 1 ? 0x4f8a4c : null });
    shrub(g, 0.13, 0.06, r, { scale: 1.1 });
    grassTuft(g, -0.12, 0.08, r, { scale: 1.2 });
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
  [0, 1, 2].forEach((i) => list.push(at(`prop.rocks.${i}`, 'stones', i, (g) => { const r = rng(950 + i); rock(g, 0, 0, r, { scale: 1.2 }); rock(g, 0.09, 0.05, r, { scale: 0.7 }); grassTuft(g, -0.07, 0.06, r); }, { shadow: false })));
  [0, 1].forEach((i) => list.push(at(`prop.grass.${i}`, 'grass', i, (g) => { const r = rng(960 + i); for (let k = 0; k < 4; k += 1) grassTuft(g, (r() - 0.5) * 0.2, (r() - 0.5) * 0.14, r, { color: [0x9cbf6a, 0xb7c98a][i] }); }, { shadow: false })));
  list.push(at('prop.bin.0', 'bin', 0, (g) => bin(g, 0, 0)));
  list.push(at('prop.bikes.0', 'bikes', 0, (g) => bikeRack(g, -0.07, 0, 3, rng(971))));
  list.push(at('prop.pot.0', 'pot', 0, (g) => pottedPlant(g, 0, 0, rng(981), 1.4)));
  list.push(at('prop.bench.x', 'bench', 0, (g) => bench(g, 0, 0, 'x')));
  list.push(at('prop.bench.z', 'bench', 1, (g) => bench(g, 0, 0, 'z')));
  list.push(at('prop.planter.0', 'planter', 0, (g) => planter(g, -0.12, -0.06, 0.24, 0.12, rng(901), { box: P.stone, h: 0.08 })));
  list.push(at('prop.bed.0', 'flowerbed', 0, (g) => flowerbed(g, -0.2, -0.12, 0.4, 0.24, rng(911)), { shadow: false }));
  return list;
}
