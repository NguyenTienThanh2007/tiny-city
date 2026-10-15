// Phase 6 browser rendering benchmark: node scripts/p6_render_benchmark.mjs [url]
// Coral Bay 3.1 with a 6-bus line, run to the morning rush, then the renderer's own per-second stats
// (window.__tinyCityRenderer: fps, average frame cost of the Pixi frame callback, drawn vehicles) are sampled at 1× and
// at 4× for 10 s each, at the default city view and zoomed into downtown. Hardware-accelerated headless Chromium.
import { chromium } from '@playwright/test';
import { coralBay31 } from './vw31_city.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.addInitScript(({ value }) => { if (sessionStorage.getItem('seeded')) return; localStorage.clear(); localStorage.setItem('tiny-city-imagine-save-v1', JSON.stringify(value)); sessionStorage.setItem('seeded', '1'); }, { value: coralBay31() });
await page.goto(base);
await page.locator('.city-viewport[data-art="ready"]').waitFor({ timeout: 30_000 });
const minute = async () => { const t = /DAY\s+(\d+)\s+·\s+(\d+):(\d+)/.exec(await page.getByLabel('Simulation clock').textContent()); return (Number(t[1]) - 1) * 1440 + Number(t[2]) * 60 + Number(t[3]); };
await page.getByRole('navigation', { name: 'Game mode' }).getByRole('button', { name: /^Live/ }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Welcome residents' }).click();
const resume = page.getByRole('button', { name: 'Resume', exact: true });
if (await resume.isVisible()) await resume.click();
await page.getByRole('button', { name: 'Speed 4x' }).click();
while (await minute() < 6 * 60 + 50) await page.waitForTimeout(150);
await page.getByRole('button', { name: 'Speed 1x' }).click();
async function sample(label) {
  const rows = [];
  for (let i = 0; i < 10; i += 1) { await page.waitForTimeout(1000); rows.push(await page.evaluate(() => window.__tinyCityRenderer)); }
  const fps = rows.map((r) => r.fps), ms = rows.map((r) => r.frameMs);
  console.log(JSON.stringify({ label, fpsAvg: +(fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(1), fpsMin: Math.min(...fps),
    frameMsAvg: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2), frameMsMax: Math.max(...ms), vehicles: Math.max(...rows.map((r) => r.vehicles ?? 0)),
    visible: Math.max(...rows.map((r) => r.visibleVehicles ?? 0)), residents: rows.at(-1).residents, gpuMB: Math.round((rows.at(-1).gpuTextureBytes ?? 0) / 1e6) }));
}
await sample('city view · 1×');
for (let i = 0; i < 4; i += 1) { await page.getByRole('button', { name: 'Zoom in' }).click(); await page.waitForTimeout(300); }
await sample('downtown close-up · 1×');
await page.getByRole('button', { name: 'Speed 4x' }).click();
await sample('downtown close-up · 4×');
for (let i = 0; i < 4; i += 1) { await page.getByRole('button', { name: 'Zoom out' }).click(); await page.waitForTimeout(300); }
await sample('city view · 4× (late morning)');
await browser.close();
