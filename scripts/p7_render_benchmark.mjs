// Phase 7 browser rendering benchmark: node scripts/p7_render_benchmark.mjs [url]
// Coral Bay Nights (scripts/p7_city.mjs) loaded at three real moments built by the engine — a weekday evening, Friday
// night (concert and night market, venue lights on) and Saturday afternoon — then run live; the renderer's own
// per-second stats (window.__tinyCityRenderer: fps, average Pixi frame cost, drawn residents) are sampled for 10 s at
// the default city view and zoomed into the entertainment district, at 1× and 4×. Hardware-accelerated Chromium.
import { chromium } from '@playwright/test';
import { cityAt } from './p7_city.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const DAY = 1440;
async function sample(page, label) {
  const rows = [];
  for (let i = 0; i < 10; i += 1) { await page.waitForTimeout(1000); rows.push(await page.evaluate(() => window.__tinyCityRenderer)); }
  const fps = rows.map((r) => r.fps), ms = rows.map((r) => r.frameMs);
  console.log(JSON.stringify({ label, fpsAvg: +(fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(1), fpsMin: Math.min(...fps),
    frameMsAvg: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2), frameMsMax: Math.max(...ms), residents: rows.at(-1).residents,
    visibleResidents: Math.max(...rows.map((r) => r.visibleResidents ?? 0)), vehicles: Math.max(...rows.map((r) => r.vehicles ?? 0)) }));
}
for (const [label, minute] of [['Monday 18:00', 18 * 60], ['Friday 20:45', 4 * DAY + 20 * 60 + 45], ['Saturday 15:00', 5 * DAY + 15 * 60]]) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const { save } = cityAt(minute);
  await page.addInitScript(({ value }) => { if (sessionStorage.getItem('seeded')) return; localStorage.clear(); localStorage.setItem('tiny-city-imagine-save-v1', value); sessionStorage.setItem('seeded', '1'); }, { value: JSON.stringify(save) });
  await page.goto(base);
  await page.locator('.city-viewport[data-art="ready"]').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await sample(page, `${label} · city view · 1×`);
  const box = await page.getByRole('button', { name: 'Navigate neighborhood overview' }).boundingBox();
  await page.mouse.click(box.x + box.width * 47 / 64, box.y + box.height * 22 / 64);
  for (let i = 0; i < 3; i += 1) { await page.getByRole('button', { name: 'Zoom in' }).click(); await page.waitForTimeout(300); }
  await sample(page, `${label} · district close-up · 1×`);
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  await sample(page, `${label} · district close-up · 4×`);
  await page.context().close();
}
await browser.close();
