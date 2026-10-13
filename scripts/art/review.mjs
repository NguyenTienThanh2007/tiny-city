// Art review sheet: node scripts/art/review.mjs [previewDir] [out.png] [zoom]
// Composes every *.color.png preview (with its shadow under it) on a lawn background, enlarged, for visual QA.
import { chromium } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'tmp-art-preview');
const out = process.argv[3] ?? join(dir, '_review.png');
const zoom = Number(process.argv[4] ?? 2.5);
const ids = readdirSync(dir).filter((f) => f.endsWith('.color.png')).map((f) => f.replace('.color.png', '')).sort();
const data = (file) => { try { return `data:image/png;base64,${readFileSync(join(dir, file)).toString('base64')}`; } catch { return null; } };
const cells = ids.map((id) => {
  const night = data(`${id}.emissive.png`);
  let anchors = {};
  try { anchors = JSON.parse(readFileSync(join(dir, `${id}.anchors.json`), 'utf8')); } catch { /* old preview */ }
  const c = anchors.color ?? { x: 0, y: 0 }, s = anchors.shadow ?? c, e = anchors.emissive ?? c;
  const shadow = data(`${id}.shadow.png`);
  return `<figure><div class="stack">${shadow ? `<img src="${shadow}" class="shadow" style="left:${c.x - s.x}px;top:${c.y - s.y}px">` : ''}<img class="color" src="${data(`${id}.color.png`)}">
  </div>${night ? `<div class="stack night"><img src="${data(`${id}.color.png`)}" class="dim"><img src="${night}" class="glow" style="left:${c.x - e.x}px;top:${c.y - e.y}px"></div>` : ''}<figcaption>${id}</figcaption></figure>`;
}).join('');
const html = `<!doctype html><style>body{margin:0;background:#9fbf86;font:12px sans-serif;display:flex;flex-wrap:wrap;gap:16px;padding:16px}
figure{margin:0;background:#a6c58c;padding:8px;border-radius:8px;display:flex;gap:8px;align-items:flex-end}
.stack{position:relative;zoom:${zoom}}.stack img{display:block}.stack .shadow{position:absolute}.stack .color{position:relative}
.night{background:#2e3a52}.dim{filter:brightness(.42) saturate(.7) hue-rotate(-12deg)}.glow{position:absolute;mix-blend-mode:screen}
figcaption{writing-mode:vertical-rl;color:#26412f}</style>${cells}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 900 } });
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('review sheet', out);
