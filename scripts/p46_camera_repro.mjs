// Phase 4.6 camera drift reproduction: node scripts/p46_camera_repro.mjs <url> [blank]
// Coral Bay at 1440×900. Reads the camera from the public minimap footprint (screen corners → world point at the
// screen centre and scale); on 4.6 builds it also prints the exact pose from `window.__tinyCityCamera`. Each step
// starts from the previous one; "home" is the Center neighborhood framing. Run it on a baseline and a 4.6 build.
import { chromium } from '@playwright/test';
import { coralBay } from './vw3b_city.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:4192';
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.addInitScript(({ value }) => {
  if (sessionStorage.getItem('seeded')) return;
  localStorage.clear();
  if (value) localStorage.setItem('tiny-city-imagine-save-v1', JSON.stringify(value));
  sessionStorage.setItem('seeded', '1');
}, { value: process.argv[3] === 'blank' ? null : coralBay() });
await page.goto(base);
await page.locator('.city-viewport[data-art="ready"]').waitFor({ timeout: 30000 });
await page.waitForTimeout(600);

const size = 64;
async function cam() {
  const box = await page.locator('canvas').boundingBox();
  const p = (await page.getByTestId('minimap-camera').getAttribute('points')).split(' ').map((q) => q.split(',').map((n) => Number(n) * size / 100));
  const w = (x, y) => ({ x: 32 * 56 + (x - y) * 28, y: (x + y) * 14 });
  const tl = w(p[0][0], p[0][1]), tr = w(p[1][0], p[1][1]), br = w(p[2][0], p[2][1]);
  const scale = box.width / (tr.x - tl.x);
  return { scale: +scale.toFixed(4), cx: +((tl.x + br.x) / 2).toFixed(1), cy: +((tl.y + br.y) / 2).toFixed(1), box };
}
// Where world point (grid gx, gy) appears on screen.
async function screenOf(gx, gy) {
  const c = await cam();
  const w = (x, y) => ({ x: 32 * 56 + (x - y) * 28, y: (x + y) * 14 });
  const t = w(gx, gy);
  return { x: +(c.box.width / 2 + (t.x - c.cx) * c.scale).toFixed(1), y: +(c.box.height / 2 + (t.y - c.cy) * c.scale).toFixed(1) };
}
async function settle() {
  await page.waitForTimeout(250);
  for (let i = 0; i < 40; i += 1) { const moving = await page.evaluate(() => window.__tinyCityCamera?.moving ?? false); if (!moving) break; await page.waitForTimeout(100); }
  await page.waitForTimeout(150);
}
const log = async (label) => {
  await settle();
  const exact = await page.evaluate(() => window.__tinyCityCamera ? (({ x, y, zoom }) => ({ x: +x.toFixed(3), y: +y.toFixed(3), zoom: +zoom.toFixed(5) }))(window.__tinyCityCamera) : null);
  console.log(label.padEnd(44), JSON.stringify({ ...(await cam()), box: undefined }), 'tile(20,20)->', JSON.stringify(await screenOf(20, 20)), exact ? 'pose ' + JSON.stringify(exact) : '');
};

await log('initial');
// 1. wheel at screen centre, 100 in/out cycles (mouse wheel notches)
await page.mouse.move(720, 450);
for (let i = 0; i < 100; i += 1) { await page.mouse.wheel(0, -100); await page.mouse.wheel(0, 100); }
await page.waitForTimeout(300);
await log('after 100 wheel cycles @ centre');
// 2. same at an off-centre cursor
await page.mouse.move(400, 650);
for (let i = 0; i < 100; i += 1) { await page.mouse.wheel(0, -100); await page.mouse.wheel(0, 100); }
await page.waitForTimeout(300);
await log('after 100 wheel cycles @ (400,650)');
// 3. buttons
await page.getByRole('button', { name: 'Center neighborhood' }).click(); await page.waitForTimeout(300);
await log('home');
for (let i = 0; i < 100; i += 1) { await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); await page.getByRole('button', { name: 'Zoom out', exact: true }).click(); }
await page.waitForTimeout(300);
await log('after 100 button cycles');
// 3b. buttons, 6 in then 6 out (hits the clamp)
for (let r = 0; r < 20; r += 1) {
  for (let i = 0; i < 6; i += 1) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  for (let i = 0; i < 6; i += 1) await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
}
await page.waitForTimeout(300);
await log('after 20x (6 in, 6 out) buttons');
for (let r = 0; r < 20; r += 1) {
  for (let i = 0; i < 12; i += 1) await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  for (let i = 0; i < 12; i += 1) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
}
await page.waitForTimeout(300);
await log('after 20x (12 out, 12 in) buttons');
// 4. trackpad pinch: ctrl wheel events with small deltas, out then back in by equal total delta
await page.getByRole('button', { name: 'Center neighborhood' }).click(); await page.waitForTimeout(300);
await log('home');
const pinch = (deltas, x, y) => page.evaluate(({ deltas, x, y }) => {
  const canvas = document.querySelector('canvas');
  for (const d of deltas) canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: d, deltaX: 0, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
}, { deltas, x, y });
for (let r = 0; r < 10; r += 1) { await pinch(Array(20).fill(3), 600, 500); await pinch(Array(20).fill(-3), 600, 500); }
await page.waitForTimeout(300);
await log('after 10 pinch gestures (20 ev out/in)');
// 5. trackpad two-finger horizontal swipe (deltaY 0)
await page.evaluate(() => { const c = document.querySelector('canvas'); for (let i = 0; i < 20; i += 1) c.dispatchEvent(new WheelEvent('wheel', { deltaX: 8, deltaY: 0, clientX: 700, clientY: 450, bubbles: true, cancelable: true })); });
await page.waitForTimeout(300);
await log('after 20 horizontal-swipe wheel events');
// 6. scroll-momentum style: many small deltas with mixed signs at the end
await page.getByRole('button', { name: 'Center neighborhood' }).click(); await page.waitForTimeout(300);
await page.evaluate(() => { const c = document.querySelector('canvas'); const ds = [-4, -6, -8, -6, -4, -2, -1, 0, 0, 1, 2, 4, 6, 8, 6, 4, 2, 1, 0, 0]; for (let r = 0; r < 10; r += 1) for (const d of ds) c.dispatchEvent(new WheelEvent('wheel', { deltaY: d, clientX: 500, clientY: 600, bubbles: true, cancelable: true })); });
await page.waitForTimeout(300);
await log('after symmetric momentum scrolls @ (500,600)');
await browser.close();
