// Phase 5 evidence: node scripts/capture_p5.mjs [url] [outDir] [--only=01,06]
// Real browser captures through the real UI. Coral Bay 3.1 (scripts/vw31_city.mjs) welcomes its residents and runs at
// 4× through real midnights, so every number on screen is a settled simulation result. The AI plan capture needs the
// build to point at an API in `local` provider mode (offline rules, no paid calls), e.g. the `p5-api-local` launch config.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { coralBay31 } from './vw31_city.mjs';

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',');
const base = args[0] ?? 'http://127.0.0.1:4195';
const out = args[1] ?? 'docs/phase-5-economy/screenshots';
mkdirSync(out, { recursive: true });
const SAVE_KEY = 'tiny-city-imagine-save-v1';
const want = (...names) => !only || names.some((name) => only.some((prefix) => name.startsWith(prefix)));
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist'] });

async function open(city, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 600 ? 2 : 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('pageerror', error.message));
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear(); localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('seeded', '1');
  }, { key: SAVE_KEY, value: city });
  await page.goto(base);
  await page.locator('.city-viewport[data-art="ready"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  return { context, page };
}
const shot = async (page, name) => {
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await page.mouse.move(2, 2);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 88 });
  console.log('captured', name);
};
const day = async (page) => Number(/DAY\s+(\d+)/.exec(await page.getByLabel('Simulation clock').textContent())[1]);
/** Welcomes residents and runs at 4× until `days` midnights have settled, then pauses. */
async function live(page, days) {
  await page.getByRole('button', { name: 'Watch residents live their day' }).click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  for (let i = 0; i < 6000 && (await day(page)) < days + 1; i += 1) await page.waitForTimeout(100);
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  await page.waitForTimeout(1200);
}
const panel = (page) => page.getByRole('region', { name: 'City economy' });
const scrollTo = (locator) => locator.evaluate((el) => el.scrollIntoView({ block: 'start' }));

if (want('01', '02', '03', '04', '05', '09')) {
  const { context, page } = await open(coralBay31());
  await live(page, 3);
  await page.getByRole('button', { name: 'City economy' }).click();
  await panel(page).waitFor();
  if (want('01')) await shot(page, '01-economy-dashboard');
  if (want('02')) {
    await page.getByRole('tab', { name: 'Income & expenses' }).click();
    await scrollTo(page.getByRole('tablist', { name: 'History chart' }));
    await shot(page, '02-history-and-money-flows');
  }
  if (want('05')) {
    await page.getByRole('slider', { name: 'Residential tax' }).fill('16');
    await page.getByRole('button', { name: 'Apply tax rates' }).click();
    await scrollTo(page.locator('.policy-card'));
    await shot(page, '05-tax-policy-estimate');
    await page.getByRole('button', { name: 'Keep current rates' }).click();
  }
  if (want('03', '04')) {
    await scrollTo(page.getByRole('list', { name: 'Businesses' }));
    await page.getByRole('list', { name: 'Businesses' }).getByRole('button').first().click();
    await page.getByRole('group', { name: 'Economic activity' }).waitFor();
    if (want('03')) await shot(page, '03-business-inspector');
    if (want('04')) {
      await page.getByRole('list', { name: 'People linked to this building' }).getByRole('button').first().click();
      await scrollTo(page.getByRole('group', { name: 'Money' }));
      await shot(page, '04-resident-money');
    }
  }
  if (want('09')) {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Build roads and buildings' }).click();
    await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Office $640', exact: true }).click();
    await shot(page, '09-build-tool-running-cost');
  }
  await context.close();
}

if (want('06')) {
  const { context, page } = await open(coralBay31());
  await live(page, 1);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.getByRole('textbox', { name: 'Describe a city change' }).fill('Build a mall and show its estimated economic impact.');
  await page.getByRole('button', { name: 'Generate AI plan' }).click();
  await page.getByRole('button', { name: 'Approve & build' }).waitFor({ timeout: 30_000 });
  await scrollTo(page.getByRole('group', { name: 'Economic impact' }));
  await shot(page, '06-ai-plan-economic-impact');
  await context.close();
}

if (want('07')) {
  // A residential street with no jobs and little money: support and services empty the treasury.
  const roads = Array.from({ length: 41 }, (_, i) => ({ x: i + 8, y: 20 }));
  const villas = Array.from({ length: 12 }, (_, i) => ({ id: `villa-${i}`, name: `Villa ${i + 1}`, kind: 'villa', x: 9 + i * 3, y: 18, createdAt: 0 }));
  const { context, page } = await open({ size: 64, funds: 300, roads, buildings: [...villas, { id: 'park', name: 'Sunny Park', kind: 'park', x: 20, y: 22, createdAt: 0 }] });
  await live(page, 3);
  await page.getByRole('button', { name: 'City economy' }).click();
  await panel(page).waitFor();
  await shot(page, '07-treasury-empty-alerts');
  await context.close();
}

if (want('08')) {
  const { context, page } = await open(coralBay31(), { width: 390, height: 844 });
  await page.getByRole('button', { name: 'Watch residents live their day' }).click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await page.getByRole('button', { name: 'Close panel' }).click().catch(() => {});
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  for (let i = 0; i < 6000 && (await day(page)) < 3; i += 1) await page.waitForTimeout(100);
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Build roads and buildings' }).click();
  await page.getByRole('button', { name: 'Open city economy' }).click();
  await panel(page).waitFor();
  await shot(page, '08-mobile-economy');
  await context.close();
}
await browser.close();
