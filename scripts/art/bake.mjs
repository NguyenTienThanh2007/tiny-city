// Offline art bake: node scripts/art/bake.mjs [--preview=id[,id]] [--out=public/art/vw3]
// Renders the procedural TINY CITY models (scripts/art/assets) in headless Chromium with Three.js using the
// game's exact isometric projection, then writes atlas pages (PNG + Pixi spritesheet JSON) and manifest.json.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const preview = arg('preview');
const out = resolve(root, arg('out') ?? 'public/art/vw3');
const previewDir = resolve(root, arg('previewDir') ?? 'tmp-art-preview');

const ATLASES = [
  { name: 'buildings', prefixes: ['villa.', 'townhouse.', 'apartment.', 'park.'] },
  { name: 'nature', prefixes: ['tree.', 'prop.'] },
  { name: 'roads', prefixes: ['road.'] },
];

const types = { '.js': 'text/javascript', '.html': 'text/html' };
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('console', (msg) => { if (msg.type() === 'error') console.error('[page]', msg.text()); });
page.on('pageerror', (error) => console.error('[pageerror]', error.message));
await page.route('http://bake.local/**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  let file;
  if (path === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body style="margin:0;background:#000">
    <script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
    <script type="module" src="/art/bake-page.js"></script></body></html>` });
  if (path.startsWith('/three/')) file = join(root, 'node_modules/three', path.slice(7));
  else if (path.startsWith('/art/')) file = join(here, path.slice(5));
  else return route.fulfill({ status: 404 });
  try { return route.fulfill({ contentType: types[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) }); }
  catch { return route.fulfill({ status: 404 }); }
});
await page.goto('http://bake.local/');
await page.waitForFunction(() => window.TC_READY === true, null, { timeout: 60_000 });
const png = (url) => Buffer.from(url.split(',')[1], 'base64');

if (preview) {
  mkdirSync(previewDir, { recursive: true });
  const ids = preview === 'all' ? await page.evaluate(() => window.TC.ids()) : preview.split(',');
  for (const id of ids) {
    const passes = await page.evaluate((assetId) => window.TC.preview(assetId), id);
    for (const [pass, value] of Object.entries(passes)) writeFileSync(join(previewDir, `${id}.${pass}.png`), png(value.url));
    writeFileSync(join(previewDir, `${id}.anchors.json`), JSON.stringify(Object.fromEntries(Object.entries(passes).map(([pass, value]) => [pass, value.anchor]))));
    console.log('preview', id, Object.keys(passes).join(','));
  }
} else {
  mkdirSync(out, { recursive: true });
  for (const file of readdirSync(out)) rmSync(join(out, file));
  const manifest = { version: 1, generator: 'scripts/art/bake.mjs', resolution: 2, tile: { w: 56, h: 28 }, sheets: [], assets: {} };
  for (const atlas of ATLASES) {
    const started = Date.now();
    const result = await page.evaluate((prefixes) => window.TC.bake(prefixes), atlas.prefixes);
    manifest.resolution = result.resolution;
    for (const pageData of result.pages) {
      const base = `${atlas.name}-${pageData.index}`;
      const image = png(pageData.url);
      writeFileSync(join(out, `${base}.png`), image);
      const sheet = { frames: pageData.frames, meta: { app: 'tiny-city-bake', version: '1', image: `${base}.png`, format: 'RGBA8888',
        size: { w: pageData.width, h: pageData.height }, scale: String(result.resolution) } };
      writeFileSync(join(out, `${base}.json`), JSON.stringify(sheet));
      manifest.sheets.push({ file: `${base}.json`, image: `${base}.png`, width: pageData.width, height: pageData.height,
        sha256: createHash('sha256').update(image).digest('hex').slice(0, 16) });
    }
    Object.assign(manifest.assets, result.manifest);
    console.log(`baked ${atlas.name}: ${Object.keys(result.manifest).length} assets, ${result.pages.length} page(s) in ${Date.now() - started} ms`);
  }
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
}
await browser.close();
