// Phase 7 evidence: node scripts/capture_p7.mjs [url] [outDir] [--only=01,08]
// Real browser captures of "Coral Bay Nights" (scripts/p7_city.mjs). Each scene's city is advanced headlessly by the
// real simulation engine (the same world settings as the game: economy, transport and society on; residents welcomed
// as the "Welcome residents" button does) to a few minutes before the moment, saved, loaded into the real game, and
// then run live at 1× to the moment and paused. Every figure on screen is a real resident doing what the simulation
// says; every number is read from the simulation.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { BUILDING_CATALOG, createWorld, serializeWorld, Simulation } from '@tiny-city/simulation';
import { coralBayNights } from './p7_city.mjs';

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',');
const base = args[0] ?? 'http://127.0.0.1:5173';
const out = args[1] ?? 'docs/phase-7-living-society/screenshots';
mkdirSync(out, { recursive: true });
const SAVE_KEY = 'tiny-city-imagine-save-v1';
const DAY = 1440;
const want = (...names) => !only || names.some((name) => only.some((prefix) => name.startsWith(prefix)));
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);

/** The bus line every scene uses: along both streets from the old town into the entertainment district. */
export const LINE_STOPS = [[20, 30], [32, 30], [44, 30], [56, 30], [56, 20], [44, 20], [32, 20], [20, 20]];

/** src/simulation/cityAdapter.ts `toCityPlan`, for a node script. */
function toCityPlan(city) {
  const blockedTiles = [];
  for (let y = 0; y < city.size; y += 1) for (let x = 0; x < city.size; x += 1) if (!(x + y < city.size * 2 - 8)) blockedTiles.push({ x, y });
  return { id: 'villa-gardens-plan', name: 'Villa Gardens', width: city.size, height: city.size, roads: city.roads.map((t) => ({ ...t })), blockedTiles,
    buildings: city.buildings.map((b) => ({ id: b.id, name: b.name, kind: BUILDING_CATALOG[b.kind].kind, type: b.kind, position: { x: b.x, y: b.y },
      footprint: { ...BUILDING_CATALOG[b.kind].footprint }, capacity: BUILDING_CATALOG[b.kind].capacity })) };
}
/** The city as the game would have it at `minute` (absolute game minutes) after welcoming residents at midnight. */
export function cityAt(minute) {
  const city = coralBayNights();
  const sim = new Simulation(createWorld({ id: 'villa-gardens-world', plan: toCityPlan(city), seed: 'villa-gardens', clock: { paused: true },
    startingFunds: city.funds, economy: {}, transport: true, society: true }));
  sim.enablePopulation({ maxCitizens: 1000 });
  sim.executeTransport({ type: 'transport.create-line', stops: LINE_STOPS.map(([x, y]) => ({ x, y })), buses: 4 });
  sim.step(minute);
  const state = sim.getState();
  return { save: { size: city.size, funds: state.budget.balance, roads: city.roads, buildings: city.buildings, saveVersion: 3, simulation: JSON.parse(serializeWorld(state)) }, state };
}

const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist'] });
async function open(minute, viewport = { width: 1440, height: 900 }) {
  const { save } = cityAt(minute);
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 600 ? 2 : 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('pageerror', error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/GL Driver/.test(message.text())) console.error('console', message.text()); });
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear(); localStorage.setItem(key, value); sessionStorage.setItem('seeded', '1');
  }, { key: SAVE_KEY, value: JSON.stringify(save) });
  await page.goto(base);
  await page.locator('.city-viewport[data-art="ready"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  return { context, page };
}
const shot = async (page, name) => {
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await page.mouse.move(2, 2);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 88 });
  log('captured', name);
};
const clockMinute = async (page) => {
  const t = /DAY\s+(\d+)\s+·\s+(\d+):(\d+)/.exec(await page.getByLabel('Simulation clock').textContent());
  return (Number(t[1]) - 1) * DAY + Number(t[2]) * 60 + Number(t[3]);
};
/** Runs live at 1× to the absolute game minute, then pauses. */
async function runTo(page, until) {
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.getByRole('button', { name: 'Speed 1x' }).click();
  while (await clockMinute(page) < until) await page.waitForTimeout(60);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(400);
}
async function settle(page) {
  await page.waitForTimeout(200);
  for (let still = 0, i = 0; still < 2 && i < 60; i += 1) {
    still = (await page.evaluate(() => window.__tinyCityCamera?.moving)) ? 0 : still + 1;
    await page.waitForTimeout(150);
  }
}
/** Centres the camera on a map point through the minimap, then zooms in `zoomIns` steps. */
async function look(page, x, y, zoomIns = 0) {
  const box = await page.getByRole('button', { name: 'Navigate neighborhood overview' }).boundingBox();
  await page.mouse.click(box.x + box.width * x / 64, box.y + box.height * y / 64);
  await settle(page);
  for (let i = 0; i < zoomIns; i += 1) { await page.getByRole('button', { name: 'Zoom in' }).click(); await settle(page); }
}
const live = async (page) => {
  const tab = page.getByRole('navigation', { name: 'Game mode' }).getByRole('button', { name: /^Live/ });
  if ((await tab.getAttribute('aria-pressed')) !== 'true') await tab.click();
  await page.waitForTimeout(300);
};
const building = (state, name) => state.plan.buildings.find((b) => b.name === name);
const centre = (b) => ({ x: b.position.x + b.footprint.width / 2, y: b.position.y + b.footprint.height / 2 });
const present = (state, id) => Object.values(state.society.residents).filter((p) => p.outing?.venueId === id && p.outing.status === 'present').length;

/** The minute (in [from, to]) when the most residents are present at a venue, scanning a headless run. */
function busiest(name, from, to) {
  const city = coralBayNights();
  const sim = new Simulation(createWorld({ id: 'villa-gardens-world', plan: toCityPlan(city), seed: 'villa-gardens', clock: { paused: true },
    startingFunds: city.funds, economy: {}, transport: true, society: true }));
  sim.enablePopulation({ maxCitizens: 1000 });
  sim.executeTransport({ type: 'transport.create-line', stops: LINE_STOPS.map(([x, y]) => ({ x, y })), buses: 4 });
  sim.step(from);
  const id = building(sim.getState(), name).id;
  let best = from, most = -1;
  for (let m = from; m <= to; m += 1) { const n = present(sim.getState(), id); if (n > most) { most = n; best = m; } sim.step(1); }
  log('busiest', name, 'at minute', best, `(${most} present)`);
  return best;
}
async function scene(name, minute, act, viewport) {
  if (!want(name)) return;
  const start = Math.max(0, minute - 12);
  const { context, page } = await open(start, viewport);
  await runTo(page, minute);
  await act(page, cityAt(minute).state);
  await context.close();
}

const evidence = {};
// 01 · A café after work (Monday): residents eat on the terrace, friends at one table.
await scene('01', want('01') ? busiest('Corner Café', 17 * 60 + 10, 20 * 60) : 0, async (page, state) => {
  const cafe = building(state, 'Corner Café');
  await look(page, centre(cafe).x, centre(cafe).y, 6);
  evidence.cafe = present(state, cafe.id);
  await shot(page, '01-cafe-social-gathering');
});
// 02 · The shopping street on Saturday afternoon.
await scene('02', want('02') ? busiest('Harbour Arcade', 5 * DAY + 12 * 60, 5 * DAY + 17 * 60) : 0, async (page, state) => {
  const shops = building(state, 'Harbour Arcade');
  await look(page, centre(shops).x, centre(shops).y, 5);
  evidence.shops = present(state, shops.id);
  await shot(page, '02-shopping-district');
});
// 03 · Friday concert: the audience on the lawn of the Bayside Stage (the event card shows the real attendance).
await scene('03', 4 * DAY + 20 * 60 + 50, async (page, state) => {
  const stage = building(state, 'Bayside Stage');
  await look(page, centre(stage).x, centre(stage).y, 5);
  evidence.concert = state.society.events.find((e) => e.venueId === stage.id && e.status === 'running')?.attendees.length ?? 0;
  await shot(page, '03-concert-event');
});
// 04 · The night market after dark on Saturday (a festival night).
await scene('04', want('04') ? busiest('Lantern Night Market', 5 * DAY + 20 * 60, 5 * DAY + 23 * 60) : 0, async (page, state) => {
  const market = building(state, 'Lantern Night Market');
  await look(page, centre(market).x, centre(market).y, 5);
  evidence.market = present(state, market.id);
  await shot(page, '04-night-market');
});
// 05 · The cinema: its inspector during an evening screening (visitors are indoors) with the marquee at dusk.
await scene('05', 5 * DAY + 19 * 60 + 40, async (page, state) => {
  const cinema = building(state, 'Bayside Cinema');
  await look(page, centre(cinema).x, centre(cinema).y, 4);
  await live(page);
  await page.getByRole('group', { name: 'Living society' }).getByRole('button', { name: 'Bayside Cinema' }).click().catch(() => {});
  if (!(await page.locator('.building-inspector').isVisible().catch(() => false))) {
    const p = await page.evaluate(([gx, gy]) => { const c = window.__tinyCityCamera; return { x: c.focalX + (32 * 56 + (gx - gy) * 28 - c.x) * c.zoom, y: c.focalY + ((gx + gy) * 14 - c.y) * c.zoom - 40 * c.zoom }; }, [centre(cinema).x, centre(cinema).y]);
    const box = await page.locator('canvas').boundingBox();
    await page.mouse.click(box.x + p.x, box.y + p.y);
  }
  evidence.cinema = present(state, cinema.id);
  await shot(page, '05-cinema');
});
// 06 · A resident's profile: personality, wellbeing, the outing with friends and why, and their friends.
await scene('06', 5 * DAY + 18 * 60 + 30, async (page, state) => {
  const s = state.society;
  const pick = Object.entries(s.residents).filter(([, p]) => p.outing?.status === 'present' && p.outing.companions.length > 0)
    .sort(([a], [b]) => s.relationships.filter((r) => r.a === b || r.b === b).length - s.relationships.filter((r) => r.a === a || r.b === a).length)[0];
  const venue = pick ? state.plan.buildings.find((b) => b.id === pick[1].outing.venueId) : null;
  await live(page);
  if (venue) {
    await look(page, centre(venue).x, centre(venue).y, 4);
    const popular = page.getByRole('group', { name: 'Living society' }).getByRole('button', { name: venue.name });
    if (await popular.isVisible().catch(() => false)) {
      await popular.click();
      // Open the first visitor listed in the venue's inspector (a real resident who is there right now).
      const visitor = page.locator('.building-inspector .people-list li').filter({ hasText: 'Visiting' }).first().getByRole('button');
      if (await visitor.isVisible().catch(() => false)) await visitor.click();
      await page.locator('.citizen-inspector').waitFor({ timeout: 5000 }).catch(() => {});
    }
  }
  evidence.profile = pick?.[0] ?? null;
  await shot(page, '06-resident-relationships');
});
// 07 · The event calendar in the Live panel.
await scene('07', 4 * DAY + 19 * 60 + 20, async (page) => {
  await live(page);
  await page.getByRole('button', { name: 'Event calendar' }).click();
  await look(page, 46, 24, 1);
  await shot(page, '07-event-calendar');
});
// 08 · The City Life feed after a lively Saturday evening (friendships, events, group outings).
await scene('08', 5 * DAY + 21 * 60 + 5, async (page) => {
  await live(page);
  await look(page, 46, 25, 1);
  await shot(page, '08-city-life-feed');
});
// 09 · Nightlife: the music club, night market and cinema lit up late on Friday.
await scene('09', 4 * DAY + 22 * 60 + 40, async (page) => {
  await look(page, 46, 21, 3);
  await shot(page, '09-nightlife');
});
// 10 · The whole entertainment district on Saturday afternoon.
await scene('10', 5 * DAY + 16 * 60, async (page, state) => {
  await look(page, 48, 25, 2);
  evidence.district = Object.values(state.society.residents).filter((p) => p.outing?.status === 'present').length;
  await shot(page, '10-entertainment-district');
});
// 11 · Phone: a venue inspector with its visitors and events in the bottom sheet.
await scene('11', 5 * DAY + 18 * 60, async (page, state) => {
  await live(page);
  await page.waitForTimeout(400);
  await page.getByRole('group', { name: 'Living society' }).scrollIntoViewIfNeeded();
  await shot(page, '11-phone-living-society');
  void state;
}, { width: 390, height: 844 });
// 12 · Organizing an event at the performance plaza (the booking is validated by the simulation).
await scene('12', 2 * DAY + 10 * 60, async (page, state) => {
  const plaza = building(state, 'Fountain Plaza');
  await look(page, centre(plaza).x, centre(plaza).y, 4);
  const p = await page.evaluate(([gx, gy]) => { const c = window.__tinyCityCamera; return { x: c.focalX + (32 * 56 + (gx - gy) * 28 - c.x) * c.zoom, y: c.focalY + ((gx + gy) * 14 - c.y) * c.zoom - 6 * c.zoom }; }, [centre(plaza).x, centre(plaza).y]);
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.click(box.x + p.x, box.y + p.y);
  await page.getByRole('group', { name: 'Organize an event' }).getByRole('button', { name: /Today|Tomorrow/ }).first().click().catch(() => {});
  await shot(page, '12-organize-event');
});
writeFileSync(`${out}/evidence.json`, JSON.stringify(evidence, null, 1));
log('evidence', JSON.stringify(evidence));
await browser.close();
