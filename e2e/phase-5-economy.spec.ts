import { expect, test, type Page } from '@playwright/test';
import { BUILDING_CATALOG, ECONOMY, Simulation, deserializeWorld, officeDemandRate, operatingNet, percentOf, projectEconomyDay, serializeWorld } from '@tiny-city/simulation';
import type { BuildingType, EconomyDayReport, WorldState } from '@tiny-city/simulation';
import { createCityWorld } from '../src/simulation/cityAdapter';
import type { CityState } from '../src/types';
import { cameraSettled } from './support/camera';
import { untilInGameTime } from './support/gameTime';

/**
 * Phase 5 browser acceptance: the economy through the real game. Every number checked comes from the saved
 * authoritative world, or from replaying that same world with the simulation package (determinism), never from
 * fixtures of expected dashboard figures.
 */
const SAVE_KEY = 'tiny-city-imagine-save-v1';
type Saved = CityState & { simulation: WorldState };
// One street (y = 20): two apartment buildings, a villa, an office, a mall and a pool on the north side; a park and
// open land on the south side for new buildings.
const fixture: CityState = { size: 64, funds: 9000, roads: Array.from({ length: 41 }, (_, i) => ({ x: i + 8, y: 20 })), buildings: [
  { id: 'apt-a', name: 'Harbor Flats', kind: 'apartment', x: 12, y: 16, createdAt: 0 },
  { id: 'apt-b', name: 'Sea Flats', kind: 'apartment', x: 17, y: 16, createdAt: 0 },
  { id: 'villa-a', name: 'Lagoon Villa', kind: 'villa', x: 22, y: 18, createdAt: 0 },
  { id: 'office', name: 'Harbor Office', kind: 'office', x: 25, y: 16, createdAt: 0 },
  { id: 'mall', name: 'Boutique Mall', kind: 'mall', x: 30, y: 15, createdAt: 0 },
  { id: 'pool', name: 'Lido Pool', kind: 'pool', x: 37, y: 16, createdAt: 0 },
  { id: 'park', name: 'Sunny Park', kind: 'park', x: 41, y: 22, createdAt: 0 },
] };
test.slow();

/** A save of `city` whose simulation already has residents and has run to `minute` of day 0 (built by the real engine). */
function snapshotAt(city: CityState, minute: number): Saved {
  const sim = new Simulation(createCityWorld(city));
  sim.enablePopulation({ maxCitizens: 1000 });
  sim.step(minute);
  sim.pause();
  return { ...city, saveVersion: 3, simulation: JSON.parse(serializeWorld(sim.getState())) } as Saved;
}

async function openCity(page: Page, save: unknown) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/GL Driver Message/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('p5')) { localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('p5', '1'); }
  }, { key: SAVE_KEY, value: save });
  await page.goto('/');
  await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', 'ready', { timeout: 30_000 });
  await cameraSettled(page);
  return errors;
}
async function save(page: Page): Promise<Saved> {
  await page.getByRole('button', { name: /^(Save|Saved)$/ }).click();
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_KEY);
}
const money = (amount: number) => `${amount < 0 ? '−' : ''}$${Math.abs(amount).toLocaleString('en-US')}`;
const economyPanel = (page: Page) => page.getByRole('region', { name: 'City economy' });
async function openEconomy(page: Page) {
  if (!(await economyPanel(page).isVisible())) await page.getByRole('button', { name: 'City economy', exact: true }).click();
  await expect(economyPanel(page)).toBeVisible();
}
const clock = (page: Page) => page.getByLabel('Simulation clock');
/** Screen point of a grid position, from the renderer's camera (`window.__tinyCityCamera`). */
async function screenOf(page: Page, gx: number, gy: number) {
  const c = await page.evaluate(() => (window as unknown as { __tinyCityCamera: { x: number; y: number; zoom: number; focalX: number; focalY: number } }).__tinyCityCamera);
  const box = (await page.locator('canvas').boundingBox())!;
  const world = { x: 32 * 56 + (gx - gy) * 28, y: (gx + gy) * 14 };
  return { x: box.x + c.focalX + (world.x - c.x) * c.zoom, y: box.y + c.focalY + (world.y - c.y) * c.zoom };
}
async function build(page: Page, type: BuildingType, x: number, y: number) {
  const label = { villa: 'Villa', duplex: 'Duplex', townhouse: 'Townhouse', apartment: 'Apt', park: 'Park', clubhouse: 'Clubhouse', pool: 'Pool', mall: 'Mall', office: 'Office',
    cafe: 'Café', shops: 'Shops', market: 'Market', cinema: 'Cinema', nightclub: 'Club', stage: 'Stage', plaza: 'Plaza', amusement: 'Fun park' }[type];
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: `${label} $${BUILDING_CATALOG[type].cost}`, exact: true }).click();
  const point = await screenOf(page, x + 0.5, y + 0.5);
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y);
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: /^Select/ }).click();
}
async function selectBuilding(page: Page, id: string, name: string) {
  const b = fixture.buildings.find((entry) => entry.id === id)!;
  const def = BUILDING_CATALOG[b.kind];
  const point = await screenOf(page, b.x + def.footprint.width / 2, b.y + def.footprint.height / 2);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#building-name')).toHaveText(name);
}
/** Runs the (running) clock until `day` has settled, within a game-time budget. */
async function untilSettled(page: Page, day: number) {
  await untilInGameTime(page, `settlement of day ${day}`, async () => (await clock(page).textContent()) ?? '',
    (text) => Number(/DAY\s+(\d+)/.exec(text)?.[1] ?? 0) >= day + 2, { within: 26 * 60 });
}

test('A/B/C/I: a new city starts with a valid economy; homes and offices change demand and jobs; the dashboard shows authoritative numbers', async ({ page }) => {
  test.setTimeout(process.env.CI ? 420_000 : 180_000);
  const errors = await openCity(page, fixture);
  // A. A fresh city has an economy from its first day, with the default policy and no history yet.
  let saved = await save(page);
  const e0 = saved.simulation.economy!;
  expect(e0).toMatchObject({ version: 1, lastSettledDay: -1, policy: { residentialTaxRate: 10, commercialTaxRate: 6 }, history: [], ledger: [] });
  expect(saved.simulation.budget.balance).toBe(9000);
  await openEconomy(page);
  await expect(page.getByTestId('economy-treasury')).toHaveText('$9,000');
  await expect(economyPanel(page)).toContainText('First day in progress');

  // Residents arrive through the real flow.
  await page.getByRole('navigation', { name: 'Game mode' }).getByRole('button', { name: /^Live/ }).click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  saved = await save(page);
  const residents = saved.simulation.citizens.length;
  expect(residents).toBe(50);
  // I. The dashboard's figures are the authoritative ones: employment from real assignments, today's estimate from
  // the engine's own projection of the saved world.
  await openEconomy(page);
  const employed = saved.simulation.citizens.filter((c) => c.workBuildingId !== null).length;
  await expect(economyPanel(page).getByRole('group', { name: 'Treasury' })).toContainText('$9,000');
  await expect(economyPanel(page)).toContainText(`${employed} of ${residents} residents · 160 jobs`);
  const today = operatingNet(projectEconomyDay(deserializeWorld(JSON.stringify(saved.simulation))));
  const estimate = economyPanel(page).getByRole('group', { name: 'Today estimate' });
  await expect(estimate).toContainText(money(today.expenses));
  await expect(estimate).toContainText(money(today.income));

  // C. An office adds 60 jobs. B. An apartment building brings 24 residents and their costs and taxes.
  await page.getByRole('button', { name: 'Close city economy' }).click();
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  await cameraSettled(page);
  await build(page, 'office', 12, 21);
  saved = await save(page);
  expect(saved.simulation.plan.buildings.filter((b) => b.type === 'office')).toHaveLength(2);
  expect(saved.simulation.budget.balance).toBe(9000 - 640);
  await openEconomy(page);
  await expect(economyPanel(page)).toContainText('· 220 jobs');
  await page.getByRole('button', { name: 'Close city economy' }).click();
  await build(page, 'apartment', 18, 21);
  const grown = await save(page);
  expect(grown.simulation.citizens.length).toBe(residents + 24);
  expect(grown.simulation.budget.balance).toBe(9000 - 640 - 480);
  const before = projectEconomyDay(deserializeWorld(JSON.stringify(saved.simulation)));
  const after = projectEconomyDay(deserializeWorld(JSON.stringify(grown.simulation)));
  expect(after.expenses.publicServices - before.expenses.publicServices).toBe(24 * 3);
  expect(after.income.residentialTax).toBeGreaterThan(before.income.residentialTax);
  await openEconomy(page);
  await expect(economyPanel(page).getByRole('group', { name: 'Today estimate' })).toContainText(money(operatingNet(after).expenses));
  expect(errors).toEqual([]);
});

test('D/E/F/G/H/J/K: midnight settles once and exactly as the engine replays it, at any speed; pause stops money; policy, inspectors and reload agree', async ({ page }) => {
  test.setTimeout(process.env.CI ? 600_000 : 240_000);
  const start = snapshotAt(fixture, 22 * 60);
  const errors = await openCity(page, start);
  // H. Raise the residential tax through the policy controls (estimate first, then apply).
  await openEconomy(page);
  await page.getByRole('slider', { name: 'Residential tax' }).fill('12');
  await expect(page.getByRole('status', { name: 'Policy estimate' })).toContainText('City income +$');
  await page.getByRole('button', { name: 'Apply tax rates' }).click();
  await expect(page.getByRole('status', { name: 'City notice' })).toContainText('Tax rates updated: residential 12%');
  const w0 = await save(page);
  expect(w0.simulation.economy!.policy).toEqual({ residentialTaxRate: 12, commercialTaxRate: 6 });

  // F. Paused: real time passes, no game time and no money move.
  await page.waitForTimeout(2500);
  const stillPaused = await save(page);
  expect(stillPaused.simulation.clock.tick).toBe(w0.simulation.clock.tick);
  expect(stillPaused.simulation.budget).toEqual(w0.simulation.budget);

  // G. The engine's own replay of this exact world says what midnight must settle to.
  const replay = new Simulation(deserializeWorld(JSON.stringify(w0.simulation)));
  replay.step(24 * 60 - (w0.simulation.clock.tick % (24 * 60)) + 1);
  const expected = replay.getState().economy!.history.at(-1)!;
  expect(expected.day).toBe(0);

  // Run to midnight changing speed on the way (2× → 4× → 1× → 4×).
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  for (const speed of ['2x', '4x', '1x', '4x']) {
    await page.getByRole('button', { name: `Speed ${speed}` }).click();
    await page.waitForTimeout(600);
  }
  await untilSettled(page, 0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const w1 = await save(page);
  const e1 = w1.simulation.economy!;
  expect(e1.history.map((r) => r.day)).toEqual([0]);
  const report: EconomyDayReport = e1.history[0]!;
  expect(report).toEqual(expected);
  // E. The treasury changed by exactly the settled report, and the HUD and dashboard show it.
  expect(report.treasuryOpen).toBe(w0.simulation.budget.balance);
  expect(w1.simulation.budget.balance).toBe(report.treasuryClose);
  expect(w1.funds).toBe(report.treasuryClose);
  await expect(page.getByRole('button', { name: 'City economy', exact: true })).toContainText(`$${report.treasuryClose.toLocaleString()}`);
  await openEconomy(page);
  await expect(page.getByTestId('economy-treasury')).toHaveText(money(report.treasuryClose));
  await expect(economyPanel(page).getByRole('table', { name: 'Recent days' })).toContainText('Day 01');
  const net = operatingNet(report);
  await expect(economyPanel(page).getByRole('group', { name: 'Treasury income' })).toContainText(money(net.income));
  await expect(economyPanel(page).getByRole('group', { name: 'Treasury expenses' })).toContainText(money(net.expenses));
  // H. The new rate applied to the settled day: residential tax is 12% of each employer's payroll.
  const finances = Object.values(e1.buildings);
  expect(report.income.residentialTax).toBe(finances.reduce((sum, f) => sum + percentOf(f.payroll, 12), 0));
  expect(report.income.residentialTax).toBeGreaterThan(finances.reduce((sum, f) => sum + percentOf(f.payroll, 10), 0));
  // D. The mall sold to residents (within what its staff can sell) and paid commercial tax; the pool earned fees.
  const mall = e1.buildings.mall!, office = e1.buildings.office!;
  expect(mall.workers).toBeGreaterThan(0);
  expect(mall.revenue).toBeGreaterThan(0);
  expect(mall.revenue).toBeLessThanOrEqual(mall.workers * 40);
  expect(mall.tax).toBe(percentOf(mall.revenue, 6));
  await expect(economyPanel(page).getByRole('list', { name: 'Businesses' })).toContainText('Boutique Mall');

  // Phase 7: with a living society, new hires join the least-staffed workplace, so the office is staffed too. Its day
  // settles exactly by the office rule: revenue per worker at the client demand for this tax rate, minus wages, upkeep and tax.
  expect(office.workers).toBeGreaterThan(0);
  expect(office.revenue).toBe(percentOf(office.workers * ECONOMY.officeRevenuePerWorker, officeDemandRate(e1.policy)));
  expect(office.profit).toBe(office.revenue - office.payroll - ECONOMY.businessUpkeep.office - office.tax);
  // J. The building inspector shows the same day for the mall.
  await page.getByRole('button', { name: 'Close city economy' }).click();
  await selectBuilding(page, 'mall', 'Boutique Mall');
  const activity = page.getByRole('group', { name: 'Economic activity' });
  await expect(activity).toContainText(`${mall.workers} / 100`);
  await expect(activity).toContainText(money(mall.revenue));
  await expect(activity).toContainText(`−${money(mall.payroll)}`);
  // The resident profile (opened from the mall's worker list) shows that resident's own money.
  const people = page.getByRole('list', { name: 'People linked to this building' });
  const firstWorker = (await people.getByRole('button').first().textContent())!;
  const worker = w1.simulation.citizens.find((c) => c.name === firstWorker && c.workBuildingId === 'mall')!;
  await people.getByRole('button').first().click();
  await expect(page.locator('#citizen-name')).toHaveText(worker.name);
  const moneyCard = page.getByRole('group', { name: 'Money' });
  await expect(moneyCard).toContainText('Employed at Boutique Mall');
  await expect(moneyCard).toContainText(money(e1.residents[worker.id]!.balance));

  // K. Save and reload: the same money, employment, history and policy; nothing settles twice.
  await page.reload();
  await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', 'ready', { timeout: 30_000 });
  const reloaded = await save(page);
  expect(reloaded.simulation.economy).toEqual(e1);
  expect(reloaded.simulation.budget).toEqual(w1.simulation.budget);
  expect(reloaded.simulation.citizens.map((c) => [c.id, c.workBuildingId])).toEqual(w1.simulation.citizens.map((c) => [c.id, c.workBuildingId]));
  await openEconomy(page);
  await expect(page.getByTestId('economy-treasury')).toHaveText(money(report.treasuryClose));
  expect(errors).toEqual([]);
});

test('N: AI Architect previews show confirmed costs and estimated economic effects, and never change the treasury', async ({ page }) => {
  test.setTimeout(process.env.CI ? 420_000 : 180_000);
  const errors = await openCity(page, snapshotAt({ ...fixture, funds: 20_000 }, 600));
  // The preview build targets the mock API; this test uses the real API running the offline rules interpreter.
  await page.route('http://127.0.0.1:8012/v1/city/**', (route) => route.continue({ url: route.request().url().replace(':8012', ':8015') }));
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  const before = await save(page);
  const impact = page.getByRole('group', { name: 'Economic impact' });
  const ask = async (prompt: string) => {
    await page.getByRole('textbox', { name: 'Describe a city change' }).fill(prompt);
    await page.getByRole('button', { name: 'Generate AI plan' }).click();
    await expect(page.getByRole('button', { name: 'Approve & build' })).toBeVisible({ timeout: 30_000 });
  };
  const cost = async () => Number((await page.locator('.proposal-metrics strong').first().textContent())!.replace(/[^0-9]/g, ''));

  await ask('Build three office buildings to create more jobs.');
  await expect(impact).toContainText('Confirmed now');
  await expect(impact).toContainText(money(await cost()));
  await expect(impact).toContainText('Estimated per day · not guaranteed');
  await expect(impact).toContainText('+180');
  expect((await save(page)).simulation).toEqual(before.simulation);
  await page.getByRole('button', { name: 'Reject' }).click();

  await ask('Xây một khu dân cư có đủ việc làm.');
  await expect(impact).toContainText('Homes (rooms)');
  await expect(impact).toContainText('+24');
  await expect(impact).toContainText('+60');
  expect((await save(page)).simulation).toEqual(before.simulation);
  await page.getByRole('button', { name: 'Reject' }).click();

  await ask('Build a mall and show its estimated economic impact.');
  await expect(impact).toContainText('+100');
  const mallCost = await cost();
  expect((await save(page)).simulation.budget).toEqual(before.simulation.budget);
  // Only approval changes the treasury, by exactly the confirmed cost; the economy itself is untouched.
  await page.getByRole('button', { name: 'Approve & build' }).click();
  await expect(page.getByRole('status', { name: 'City notice' })).toContainText('AI city plan applied', { timeout: 30_000 });
  const applied = await save(page);
  expect(applied.simulation.budget.balance).toBe(before.simulation.budget.balance - mallCost);
  expect(applied.simulation.budget.operatingIncome ?? 0).toBe(before.simulation.budget.operatingIncome ?? 0);
  expect(applied.simulation.economy!.ledger).toEqual(before.simulation.economy!.ledger);
  expect(errors).toEqual([]);
});

test('L/O/P: a guest plays with no console errors; Life View and the baked 3.1 architecture still work; phones reach the economy', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 120_000);
  // A first character in a city whose residents have not arrived yet (they move in with the character).
  const errors = await openCity(page, fixture);
  // O. Life Mode and Life View on top of the economy.
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  await page.getByRole('dialog', { name: 'Create your character' }).getByLabel('Character name').fill('Mai');
  await page.getByRole('button', { name: /Next: choose a home/ }).click();
  await page.getByRole('list', { name: 'Homes' }).getByRole('button', { name: /Lagoon Villa/ }).click();
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: 'Move in & start' }).click();
  await expect(page.getByRole('status', { name: 'City notice' })).toContainText('Welcome home, Mai!');
  await expect(page.getByRole('group', { name: 'Character camera' }).getByRole('button', { name: 'Life view' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __tinyCityCamera?: { following: boolean } }).__tinyCityCamera?.following)).toBe(true);
  // The character is not an economic actor in Phase 5: residents' accounts are unchanged by moving in.
  const saved = await save(page);
  expect(saved.simulation.player?.homeBuildingId).toBe('villa-a');
  // P. Premium baked art everywhere, no vector fallbacks.
  const stats = await page.evaluate(() => (window as unknown as { __tinyCityRenderer?: { vectorBuildings?: number; bakedBuildings?: number } }).__tinyCityRenderer);
  expect(stats?.vectorBuildings).toBe(0);
  expect(stats?.bakedBuildings).toBeGreaterThan(0);
  // Phones: the Build panel leads to the economy sheet; no horizontal overflow.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('navigation', { name: 'Game mode' }).getByRole('button', { name: /^Build/ }).click();
  await page.getByRole('button', { name: 'Open city economy' }).click();
  await expect(economyPanel(page)).toBeVisible();
  await expect(page.getByTestId('economy-treasury')).toHaveText(money(saved.simulation.budget.balance));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // L. A guest session never produced a failed request or console error.
  expect(errors).toEqual([]);
});
