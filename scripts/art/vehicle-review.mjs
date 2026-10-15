// Vehicle art review sheet: node scripts/art/vehicle-review.mjs [out.png] [zoom]
// Composes the baked vehicle layers exactly like the game does (shadow, tinted body, detail, lights) for every model
// and heading, by day on a road tone and by night (dimmed with the lights screened on), plus the bus-stop shelters.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const out = process.argv[2] ?? resolve(root, 'tmp-art-preview/_vehicles.png');
const zoom = Number(process.argv[3] ?? 2);
const manifest = JSON.parse(readFileSync(resolve(root, 'public/art/vw3/manifest.json'), 'utf8'));
const sheets = manifest.vehicles.sheets.map((s) => ({ data: JSON.parse(readFileSync(resolve(root, 'public/art/vw3', s.file), 'utf8')),
  image: `data:image/webp;base64,${readFileSync(resolve(root, 'public/art/vw3', s.image)).toString('base64')}` }));
const html = `<!doctype html><body style="margin:0;background:#c9c3b6;font:12px sans-serif"><canvas id="c"></canvas><script>
const sheets = ${JSON.stringify(sheets)}; const meta = ${JSON.stringify(manifest.vehicles)}; const zoom = ${zoom};
const tints = { compact: 0xe88b74, sedan: 0x5fb0aa, suv: 0x3d464b, van: 0xf1c45f, bus: 0x2f8f83 };
(async () => {
  const frames = new Map();
  for (const s of sheets) { const img = new Image(); img.src = s.image; await img.decode(); for (const [n, f] of Object.entries(s.data.frames)) frames.set(n, { img, ...f }); }
  const cell = 64, cols = meta.directions, rows = meta.models.length * 2 + 1;
  const c = document.getElementById('c'); c.width = cols * cell * zoom; c.height = rows * cell * zoom + 40;
  const ctx = c.getContext('2d'); ctx.scale(zoom, zoom);
  const draw = (name, x, y, { tint = null, alpha = 1, mode = 'source-over', filter = 'none' } = {}) => {
    const f = frames.get(name); if (!f) return;
    const ax = f.anchor.x * f.frame.w, ay = f.anchor.y * f.frame.h, s = 1 / meta.resolution;
    const tmp = document.createElement('canvas'); tmp.width = f.frame.w; tmp.height = f.frame.h; const t = tmp.getContext('2d');
    t.drawImage(f.img, f.frame.x, f.frame.y, f.frame.w, f.frame.h, 0, 0, f.frame.w, f.frame.h);
    if (tint !== null) { t.globalCompositeOperation = 'multiply'; t.fillStyle = '#' + tint.toString(16).padStart(6, '0'); t.fillRect(0, 0, f.frame.w, f.frame.h); t.globalCompositeOperation = 'destination-in'; t.drawImage(f.img, f.frame.x, f.frame.y, f.frame.w, f.frame.h, 0, 0, f.frame.w, f.frame.h); }
    ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = mode; ctx.filter = filter;
    ctx.drawImage(tmp, x - ax * s, y - ay * s, f.frame.w * s, f.frame.h * s); ctx.restore();
  };
  meta.models.forEach((model, m) => {
    for (const night of [false, true]) {
      const row = m * 2 + (night ? 1 : 0);
      ctx.fillStyle = night ? '#2c3445' : '#8d969b'; ctx.fillRect(0, row * cell, cols * cell, cell);
      for (let d = 0; d < meta.directions; d += 1) {
        const x = d * cell + cell / 2, y = row * cell + cell / 2 + 6;
        draw('veh:' + model + ':shadow:' + d, x, y, { alpha: night ? 0.12 : 0.28 });
        draw('veh:' + model + ':body:' + d, x, y, { tint: tints[model], filter: night ? 'brightness(.45) saturate(.7)' : 'none' });
        draw('veh:' + model + ':detail:' + d, x, y, { filter: night ? 'brightness(.45) saturate(.7)' : 'none' });
        if (night) draw('veh:' + model + ':lights:' + d, x, y, { mode: 'screen' });
      }
    }
  });
  const y = meta.models.length * 2 * cell;
  ctx.fillStyle = '#8d969b'; ctx.fillRect(0, y, cols * cell, cell);
  meta.stops.forEach((side, i) => { draw('stop:' + side + ':shadow', i * cell * 2 + cell, y + cell / 2 + 8, { alpha: 0.28 }); draw('stop:' + side + ':color', i * cell * 2 + cell, y + cell / 2 + 8); });
  document.title = 'ready';
})();
</script>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await page.setContent(html);
await page.waitForFunction(() => document.title === 'ready');
await page.locator('#c').screenshot({ path: out });
await browser.close();
console.log('wrote', out);
