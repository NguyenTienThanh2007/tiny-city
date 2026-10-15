import { expect, test, type Page } from '@playwright/test';
import { deserializeWorld, serializeWorld, Simulation, validateWorld } from '@tiny-city/simulation';
import type { Relationship, WorldState } from '@tiny-city/simulation';
import { createCityWorld } from '../src/simulation/cityAdapter';
import { personalitySummary } from '../src/simulation/societyView';
import type { CityState } from '../src/types';
import { cameraSettled } from './support/camera';
import { untilClock, untilInGameTime } from './support/gameTime';

/**
 * Phase 7 browser acceptance: the living society through the real game. Saves are built with the real engine (so a
 * test can start on a Friday without days of waiting on slow runners); every check reads the authoritative saved
 * world, never fixtures of expected numbers.
 */
const SAVE_KEY = 'tiny-city-imagine-save-v1';
type Saved = CityState & { simulation: WorldState };
const DAY = 1440;

// A compact entertainment town: two streets (y = 14 and y = 26) joined by three avenues; homes north and south,
// an office, two cafés, a shopping street, a night market, a cinema, a music club, a concert stage, a plaza and a park.
const road = (x0: number, y0: number, x1: number, y1: number) => {
  const tiles: { x: number; y: number }[] = [];
  for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) tiles.push({ x, y });
  return tiles;
};
const b = (id: string, kind: CityState['buildings'][number]['kind'], x: number, y: number) => ({ id, name: id, kind, x, y, createdAt: 0 });
const fixture: CityState = { size: 64, funds: 9000,
  roads: [...road(8, 14, 52, 14), ...road(8, 26, 52, 26), ...road(8, 15, 8, 25), ...road(30, 15, 30, 25), ...road(52, 15, 52, 25)],
  buildings: [b('apt-a', 'apartment', 10, 10), b('apt-b', 'apartment', 15, 10), b('apt-c', 'apartment', 20, 10), b('row-a', 'townhouse', 25, 11), b('row-b', 'townhouse', 27, 11),
    b('office', 'office', 10, 15), b('cafe', 'cafe', 16, 15), b('shops', 'shops', 19, 15), b('market', 'market', 24, 15), b('cinema', 'cinema', 32, 15), b('club', 'nightclub', 36, 15),
    b('stage', 'stage', 32, 22), b('plaza', 'plaza', 37, 23), b('park', 'park', 42, 22),
    b('villa-a', 'villa', 10, 27), b('villa-b', 'villa', 13, 27), b('villa-c', 'villa', 16, 27), b('bistro', 'cafe', 20, 27)] };
test.slow();

/** The fixture with residents welcomed at midnight, run by the real engine to `minute`; `patch` adjusts the world. */
function snapshotAt(minute: number, patch: (world: WorldState) => WorldState = (w) => w): Saved {
  const sim = new Simulation(createCityWorld(fixture));
  sim.enablePopulation({ maxCitizens: 1000 });
  sim.step(minute);
  sim.pause();
  const world = patch(sim.getState());
  validateWorld(world);
  return { ...fixture, funds: world.budget.balance, saveVersion: 3, simulation: JSON.parse(serializeWorld(world)) } as Saved;
}
async function openCity(page: Page, save: unknown) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/GL Driver Message|Failed to load resource/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('p7')) { localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('p7', '1'); }
  }, { key: SAVE_KEY, value: save });
  await page.goto('/');
  await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', 'ready', { timeout: 30_000 });
  await cameraSettled(page);
  return errors;
}
async function saveNow(page: Page): Promise<Saved> {
  await page.getByRole('button', { name: /^(Save|Saved)$/ }).click();
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_KEY);
}
async function runTo(page: Page, minuteOfDay: number) {
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible()) await resume.click();
  await untilClock(page, minuteOfDay);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
}
const live = async (page: Page) => {
  await page.getByRole('navigation', { name: 'Game mode' }).getByRole('button', { name: /^Live/ }).click();
  await expect(page.getByRole('group', { name: 'Living society' })).toBeVisible();
};
const present = (w: WorldState, venue: string) => Object.values(w.society!.residents).filter((p) => p.outing?.venueId === venue && p.outing.status === 'present');
const purchasesAt = (w: WorldState, venue: string) => Object.values(w.economy!.today.purchases ?? {}).reduce((sum, m) => sum + (m[venue] ?? 0), 0);

test('a weekday evening: personalities choose different outings, cafés after work, thrift picks free, pause and replay are exact', async ({ page }) => {
  // One employed resident is made thrifty and short of money (a legitimate world state) before the evening.
  let thrifty = '';
  const save = snapshotAt(16 * 60 + 40, (w) => {
    const c = w.citizens.find((x) => x.workBuildingId !== null)!;
    thrifty = c.id;
    const s = w.society!;
    return { ...w, economy: { ...w.economy!, residents: { ...w.economy!.residents, [c.id]: { balance: 30, income: 0, taxes: 0, spending: 0 } } },
      society: { ...s, residents: { ...s.residents, [c.id]: { ...s.residents[c.id]!, traits: { ...s.residents[c.id]!.traits, frugality: 95 }, interests: ['outdoors', 'arts'] } } } };
  });
  const errors = await openCity(page, save);
  await runTo(page, 19 * 60);
  const evening = (await saveNow(page)).simulation;
  const today = evening.society!.today;
  // A: different residents chose different activities; every decision carries its reasons.
  expect(Object.keys(today.visitsByKind).length).toBeGreaterThanOrEqual(3);
  const chosen = Object.values(evening.society!.residents).filter((p) => p.lastChoice);
  expect(chosen.length).toBeGreaterThan(20);
  expect(chosen.every((p) => p.lastChoice!.reasons.length > 0 || p.lastChoice!.kind === 'stay-home')).toBe(true);
  // C: residents ate out after work, and paid the café.
  expect(today.visitsByKind.dine ?? 0).toBeGreaterThan(0);
  expect(purchasesAt(evening, 'cafe') + purchasesAt(evening, 'bistro')).toBeGreaterThan(0);
  // D: the thrifty resident spent nothing at any business and chose something free (or stayed in to save).
  expect(Object.values(evening.economy!.today.purchases?.[thrifty] ?? {}).reduce((a, n) => a + n, 0)).toBe(0);
  const choice = evening.society!.residents[thrifty]!.lastChoice!;
  expect(['park', 'plaza', 'visit', 'stay-home']).toContain(choice.kind);

  // J: a visitor's profile shows their real personality, interests, outing and reasons.
  await live(page);
  const busiest = Object.entries(evening.society!.residents).filter(([, p]) => p.outing?.status === 'present' && p.outing.kind !== 'visit')[0]!;
  await page.getByRole('group', { name: 'Living society' }).getByRole('button', { name: busiest[1].outing!.venueId, exact: true }).click();
  await page.locator('.building-inspector .people-list li').filter({ hasText: 'Visiting' }).first().getByRole('button').click();
  const social = page.getByRole('group', { name: 'Social life' });
  await expect(social).toBeVisible();
  const name = (await page.locator('#citizen-name').textContent())!;
  const person = evening.citizens.find((c) => c.name === name)!;
  const profile = evening.society!.residents[person.id]!;
  for (const word of personalitySummary(profile.traits)) await expect(social).toContainText(word);
  await expect(social.getByRole('list', { name: 'Interests' }).getByRole('listitem')).toHaveCount(2);
  await expect(social.getByLabel('Current outing')).toBeVisible();
  await expect(social.getByLabel('Why')).toContainText(/Chose to|Decided to stay in/);

  // M: paused, nothing in the society moves.
  await page.waitForTimeout(1500);
  expect((await saveNow(page)).simulation.society).toEqual(evening.society);
  // N: twenty Step presses in the browser equal the engine replaying the same save (society included).
  for (let i = 0; i < 20; i += 1) await page.getByRole('button', { name: 'Step', exact: true }).click();
  const stepped = (await saveNow(page)).simulation;
  expect(stepped.clock.tick).toBe(evening.clock.tick + 20);
  const replay = new Simulation(deserializeWorld(JSON.stringify(evening)));
  replay.step(20);
  expect(serializeWorld(deserializeWorld(JSON.stringify(stepped)))).toBe(serializeWorld(replay.getState()));
  expect(errors).toEqual([]);
});

test('a Friday: coworkers become friends at lunch, the concert and night market fill with real residents, it all survives reload', async ({ page }) => {
  // Find a coworker pair who will lunch together at 12:00 (the real engine decides), and start them just short of friends.
  const base = new Simulation(createCityWorld(fixture));
  base.enablePopulation({ maxCitizens: 1000 });
  base.step(4 * DAY + 11 * 60 + 40);
  const before = new Map(base.getState().society!.relationships.map((r) => [`${r.a}|${r.b}`, r.strength]));
  base.step(25);
  const lunch = base.getState().society!.relationships.find((r) => r.strength - (before.get(`${r.a}|${r.b}`) ?? 0) === 5 && r.strength < 60)!;
  expect(lunch).toBeDefined();
  const save = snapshotAt(4 * DAY + 11 * 60 + 40, (w) => {
    const s = w.society!;
    const edge: Relationship = { a: lunch.a, b: lunch.b, strength: 37, since: 0, lastDay: 3, gainedToday: 0 };
    const relationships = [...s.relationships.filter((r) => !(r.a === lunch.a && r.b === lunch.b)), edge].sort((x, y) => `${x.a}|${x.b}` < `${y.a}|${y.b}` ? -1 : 1);
    return { ...w, society: { ...s, relationships } };
  });
  const errors = await openCity(page, save);
  const noon = (await saveNow(page)).simulation;
  // I: before evening, the night market is closed and empty.
  expect(present(noon, 'market')).toHaveLength(0);
  await live(page);
  await runTo(page, 12 * 60 + 30);
  // B and K: the pair became friends at lunch; the City Life feed says so.
  const [a, bb] = [noon.citizens.find((c) => c.id === lunch.a)!.name, noon.citizens.find((c) => c.id === lunch.b)!.name];
  await expect(page.locator('.life-feed')).toContainText(`${a} and ${bb} became friends`);
  const afterLunch = (await saveNow(page)).simulation;
  const bond = afterLunch.society!.relationships.find((r) => r.a === lunch.a && r.b === lunch.b)!;
  expect(bond.strength).toBeGreaterThanOrEqual(40);

  await runTo(page, 20 * 60 + 30);
  const night = (await saveNow(page)).simulation;
  // G and H: the concert runs with real attendees who are at the stage, within its capacity.
  const concert = night.society!.events.find((e) => e.venueId === 'stage' && e.status === 'running')!;
  expect(concert).toBeDefined();
  expect(concert.attendees.length).toBeGreaterThan(0);
  expect(concert.attendees.length).toBeLessThanOrEqual(concert.capacity);
  for (const id of concert.attendees) expect(night.citizens.find((c) => c.id === id)!.movement!.currentBuildingId).toBe('stage');
  await page.getByRole('button', { name: 'Event calendar' }).click();
  await expect(page.getByRole('list', { name: 'Event calendar' })).toContainText(`On now · ${concert.attendees.length} here`);
  // I: the night market is busy after dark.
  expect(present(night, 'market').length).toBeGreaterThan(0);
  // E: residents drove to venues (their cars are parked there).
  expect(Object.values(night.transport!.parkedCars).some((place) => ['cafe', 'bistro', 'market', 'shops', 'cinema', 'club', 'stage', 'plaza', 'park'].includes(place))).toBe(true);
  // K: the concert was announced in the feed.
  await expect(page.locator('.life-feed')).toContainText('has started');
  // L: reload keeps relationships, outings and events exactly.
  await page.reload();
  await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', 'ready', { timeout: 30_000 });
  const reloaded = (await saveNow(page)).simulation;
  expect(reloaded.society).toEqual(night.society);
  expect(errors).toEqual([]);
});

test('a Saturday: the shopping street sells to real visitors, a venue demolished mid-visit reconciles, the economy shows city events', async ({ page }) => {
  const errors = await openCity(page, snapshotAt(5 * DAY + 13 * 60 + 30));
  await runTo(page, 15 * 60);
  const afternoon = (await saveNow(page)).simulation;
  // F: real shoppers, and their purchases recorded for the shopping street.
  expect(present(afternoon, 'shops').length).toBeGreaterThan(0);
  expect(purchasesAt(afternoon, 'shops')).toBeGreaterThan(0);
  // R: yesterday's settled report includes the Friday concert's cost, and the dashboard shows that exact row.
  const report = afternoon.economy!.history.at(-1)!;
  expect(report.expenses.events ?? 0).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'City economy', exact: true }).click();
  await expect(page.getByRole('region', { name: 'City economy' })).toContainText('City events');
  await page.getByRole('button', { name: 'City economy', exact: true }).click();
  // O: demolishing the busy shopping street ends its outings safely; no reference to it remains.
  await live(page);
  await page.getByRole('group', { name: 'Living society' }).getByRole('button', { name: 'shops', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Venue' })).toBeVisible();
  await page.getByRole('button', { name: 'Bulldoze selected building' }).click();
  await expect.poll(async () => (await saveNow(page)).simulation.plan.buildings.some((x) => x.id === 'shops')).toBe(false);
  const after = (await saveNow(page)).simulation;
  validateWorld(deserializeWorld(JSON.stringify(after)));
  expect(after.plan.buildings.some((x) => x.id === 'shops')).toBe(false);
  expect(Object.values(after.society!.residents).some((p) => p.outing?.venueId === 'shops')).toBe(false);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await untilInGameTime(page, 'the city carries on', async () => (await saveNow(page)).simulation.clock.tick, (tick) => tick > after.clock.tick + 30, { within: 60 });
  expect(errors).toEqual([]);
});

test('the AI Architect plans an entertainment district; the player eats out at a café', async ({ page }) => {
  const errors = await openCity(page, { ...fixture, buildings: fixture.buildings.filter((x) => !['cafe', 'cinema', 'market'].includes(x.id)) });
  // P: the offline rules interpreter (real API, no paid calls) understands the venues; preview first, then approval.
  await page.route('http://127.0.0.1:8012/v1/city/**', (route) => route.continue({ url: route.request().url().replace(':8012', ':8015') }));
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.getByRole('textbox', { name: 'Describe a city change' }).fill('Xây một khu phố giải trí với quán cà phê, rạp chiếu phim và chợ đêm.');
  await page.getByRole('button', { name: 'Generate AI plan' }).click();
  await expect(page.getByRole('button', { name: 'Approve & build' })).toBeVisible({ timeout: 30_000 });
  const preview = await saveNow(page);
  expect(preview.simulation.plan.buildings.some((x) => x.type === 'cinema')).toBe(false);
  await page.getByRole('button', { name: 'Approve & build' }).click();
  await expect(page.getByRole('status', { name: 'City notice' })).toContainText('AI city plan applied');
  const built = (await saveNow(page)).simulation;
  for (const type of ['cafe', 'cinema', 'market']) expect(built.plan.buildings.some((x) => x.type === type && x.id !== 'bistro')).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await saveNow(page)).simulation.plan.buildings.some((x) => x.type === 'cinema')).toBe(false);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();

  // Q: Life Mode with the society: the character moves in and eats out at the new café once it opens.
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  const creator = page.getByRole('dialog', { name: 'Create your character' });
  await creator.getByLabel('Character name').fill('Mai');
  await creator.getByRole('button', { name: /Next: choose a home/ }).click();
  await page.getByRole('list', { name: 'Homes' }).getByRole('button', { disabled: false }).first().click();
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: 'Move in & start' }).click();
  await runTo(page, 8 * 60);
  const world = (await saveNow(page)).simulation;
  // The bistro on the front street (nothing stands in front of it on screen).
  const cafe = world.plan.buildings.find((x) => x.id === 'bistro')!;
  // The Life camera frames the character; switch to City view to reach the café.
  await page.getByRole('button', { name: 'City view' }).click();
  await cameraSettled(page);
  const map = (await page.getByRole('button', { name: 'Navigate neighborhood overview' }).boundingBox())!;
  await page.mouse.click(map.x + map.width * (cafe.position.x + 1) / 64, map.y + map.height * (cafe.position.y + 1) / 64);
  await cameraSettled(page);
  for (let i = 0; i < 4; i += 1) { await page.getByRole('button', { name: 'Zoom in' }).click(); await cameraSettled(page); }
  const c = await page.evaluate(() => (window as unknown as { __tinyCityCamera: { x: number; y: number; zoom: number; focalX: number; focalY: number } }).__tinyCityCamera);
  const box = (await page.locator('canvas').boundingBox())!;
  const gx = cafe.position.x + 1, gy = cafe.position.y + 1;
  await page.mouse.click(box.x + c.focalX + (32 * 56 + (gx - gy) * 28 - c.x) * c.zoom, box.y + c.focalY + ((gx + gy) * 14 - c.y) * c.zoom);
  const place = page.getByRole('region', { name: `Place: ${cafe.name}` });
  await expect(place).toBeVisible();
  await place.getByRole('button', { name: /Eat here/ }).click();
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible()) await resume.click();
  await untilInGameTime(page, 'eating at the café', async () => (await page.getByRole('status', { name: 'Current activity' }).textContent()) ?? '', (text) => text.includes(`Eating at ${cafe.name}`), { within: 240 });
  expect(errors).toEqual([]);
});
