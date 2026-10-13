import { expect, test } from '@playwright/test';

/** Accounts are optional: a signed-out visitor plays as a guest without any failed request or console error. */
test('a guest loads and reloads the game with no failed requests, no console errors and no account access', async ({ page, request }) => {
  const errors: string[] = [];
  const failed: string[] = [];
  const sessionChecks: number[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/GL Driver Message/.test(message.text())) errors.push(message.text()); });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname === '/v1/auth/session') sessionChecks.push(response.status());
    if (response.status() >= 400) failed.push(`${response.status()} ${url.pathname}`);
  });

  for (const visit of ['load', 'reload']) {
    if (visit === 'load') await page.goto('/'); else await page.reload();
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  }
  // Each page load asked who is signed in and got a normal guest answer.
  await expect.poll(() => sessionChecks.length).toBeGreaterThanOrEqual(2);
  expect(sessionChecks.every((status) => status === 200)).toBe(true);
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);

  // Guest mode never weakens access rules: account data still needs a signed-in session.
  const api = 'http://127.0.0.1:8012';
  expect((await request.get(`${api}/v1/auth/session`)).status()).toBe(200);
  expect(await (await request.get(`${api}/v1/auth/session`)).json()).toEqual({ authenticated: false, user: null });
  expect((await request.get(`${api}/v1/auth/me`)).status()).toBe(401);
  expect((await request.get(`${api}/v1/users/me/cities`)).status()).toBe(401);
});
