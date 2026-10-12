// AI Architect 2.0 visual QA: node scripts/capture_ai.mjs [devUrl] [apiUrl] [outDir]
// Needs the dev server (its API base is rerouted to apiUrl, e.g. a TINY_CITY_PROVIDER_MODE=local server).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173', api = process.argv[3] ?? 'http://127.0.0.1:8016', out = process.argv[4] ?? 'docs/ai-architect/screenshots';
mkdirSync(out, { recursive: true });
const city = { size: 64, funds: 20000, roads: [...Array.from({ length: 41 }, (_, i) => ({ x: i + 8, y: 20 })), ...Array.from({ length: 41 }, (_, i) => ({ x: i + 8, y: 30 })), ...Array.from({ length: 9 }, (_, i) => ({ x: 8, y: i + 21 }))],
  buildings: [{ id: 'villa-a', name: 'Lagoon Villa', kind: 'villa', x: 10, y: 21, createdAt: 0 }, { id: 'villa-b', name: 'Palm Villa', kind: 'villa', x: 13, y: 21, createdAt: 0 },
    { id: 'apt-a', name: 'Harbor Flats', kind: 'apartment', x: 20, y: 21, createdAt: 0 }, { id: 'apt-b', name: 'Sea Flats', kind: 'apartment', x: 30, y: 21, createdAt: 0 },
    { id: 'office', name: 'Harbor Office', kind: 'office', x: 40, y: 21, createdAt: 0 }] };
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function open(foreign = false) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.addInitScript((value) => { if (!sessionStorage.getItem('s')) { localStorage.setItem('tiny-city-imagine-save-v1', JSON.stringify(value)); sessionStorage.setItem('s', '1'); } }, city);
  // Planner calls go to /api (dev proxy) or a configured base URL; send them to `api` (or simulate a foreign service).
  await page.route((url) => /\/v1\/city\/|\/openapi\.json$|\/health$/.test(url.pathname), (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api(?=\/)/, '');
    if (foreign) return route.fulfill(path === '/openapi.json' ? { status: 200, json: { info: { title: 'F01 API' } } } : { status: 404, json: { detail: 'Not Found' } });
    return route.continue({ url: `${api}${path}` });
  });
  await page.goto(base);
  await page.locator('canvas').waitFor();
  await page.waitForTimeout(1200);
  return page;
}
const shot = async (page, name) => { await page.mouse.move(2, 2); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 85 }); console.log('captured', name); };
const ask = async (page, prompt) => { await page.getByRole('textbox', { name: 'Describe a city change' }).fill(prompt); await page.getByRole('button', { name: 'Generate AI plan' }).click(); };
{
  const page = await open();
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await ask(page, 'Phá apartment đi.');
  await page.getByRole('region', { name: 'Choose buildings' }).waitFor();
  await page.getByRole('radio', { name: /Sea Flats/ }).check();
  await shot(page, '01-choose-target');
  await page.getByRole('button', { name: 'Use these buildings' }).click();
  await page.getByRole('region', { name: 'Authorization required' }).waitFor();
  await shot(page, '02-authorization');
  await page.getByRole('button', { name: 'Allow this change' }).click();
  await page.getByRole('button', { name: 'Review destructive edits' }).waitFor();
  await shot(page, '03-demolition-preview-impact');
  await page.getByRole('button', { name: 'Review destructive edits' }).click();
  await shot(page, '04-destructive-confirmation');
  await page.getByRole('button', { name: 'Confirm & apply' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await ask(page, 'Xây 10 biệt thự và 2 chung cư, thêm đường kết nối.');
  await page.getByRole('button', { name: 'Approve & build' }).waitFor();
  await shot(page, '05-build-preview');
}
{
  const page = await open(true);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await ask(page, 'Xây 2 biệt thự gần công viên');
  await page.getByRole('region', { name: 'Planner recovery' }).waitFor();
  await shot(page, '06-wrong-service');
}
await browser.close();
