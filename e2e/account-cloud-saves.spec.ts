import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const SAVE_KEY = 'tiny-city-imagine-save-v1';
const API = 'http://127.0.0.1:8012';

async function latestToken(request: APIRequestContext, email: string, subject: string) {
  const response = await request.get(`${API}/v1/dev/mailbox`);
  expect(response.ok()).toBeTruthy();
  const { messages } = await response.json() as { messages: Array<{ to: string; subject: string; text: string }> };
  const message = [...messages].reverse().find((entry) => entry.to === email && entry.subject === subject);
  expect(message).toBeTruthy();
  const match = message!.text.match(/#token=([A-Za-z0-9_-]+)/);
  expect(match).toBeTruthy();
  return match![1];
}

test('register, verify, sign in, upload/load cloud city, sign out and reset password', async ({ page, request }) => {
  test.setTimeout(90_000);
  const email = `tiny-city-${Date.now()}@example.com`;
  const password = 'A secure tiny city passphrase! 2026';
  const resetPassword = 'A different secure city passphrase! 2026';

  await page.goto('/register');
  await page.getByLabel('Display name').fill('Cloud Builder');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

  const verificationToken = await latestToken(request, email, 'Verify your TINY CITY email');
  await page.goto(`/verify-email#token=${verificationToken}`);
  await expect(page.getByRole('status')).toContainText('Email verified');
  await page.getByRole('button', { name: 'Continue to sign in' }).click();

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: /Cloud Builder/ })).toBeVisible();

  await page.getByRole('button', { name: /^Save$/ }).click();
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cloud', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My cities' })).toBeVisible();
  await page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Upload as a new cloud city' }).click();
  await expect(page.getByText('A new cloud copy was created.')).toBeVisible();
  const cloudCity = page.locator('.cloud-save-card').filter({ hasText: 'Villa Gardens' });
  await expect(cloudCity).toBeVisible();
  const ownerSaveId = await page.evaluate(async (apiUrl) => {
    const response = await fetch(`${apiUrl}/v1/users/me/cities`, { credentials: 'include' });
    const body = await response.json() as { saves: Array<{ id: string }> };
    return body.saves[0]?.id ?? null;
  }, API);
  expect(ownerSaveId).toBeTruthy();

  // Simulate a second device with no local city. The cloud snapshot remains untouched until an explicit load.
  await page.evaluate((key) => localStorage.removeItem(key), SAVE_KEY);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My cities' })).toBeVisible();
  await expect(page.getByText('No saved city found')).toBeVisible();
  await page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Load to this device' }).click();
  await expect(page.locator('canvas')).toBeVisible();
  // Loading a cloud city navigates into the game; a poll that lands mid-navigation just tries again.
  await expect.poll(() => page.evaluate((key) => {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value).simulation?.schemaVersion : null;
  }, SAVE_KEY).catch(() => null)).toBe(2);

  await page.getByRole('button', { name: /Cloud Builder/ }).click();
  await expect(page.getByRole('heading', { name: 'Profile & security' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset instructions' }).click();
  await expect(page.getByRole('status')).toContainText('If this email has an eligible account');
  const resetToken = await latestToken(request, email, 'Reset your TINY CITY password');
  await page.goto(`/reset-password#token=${resetToken}`);
  await page.getByLabel('New password', { exact: true }).fill(resetPassword);
  await page.getByLabel('Confirm new password', { exact: true }).fill(resetPassword);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByRole('status')).toContainText('Password changed');
  await page.getByRole('button', { name: 'Continue to sign in' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(resetPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: /Cloud Builder/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toHaveCount(0);

  // A separate verified account must not see or read the first user's cloud city.
  await page.getByRole('button', { name: /Cloud Builder/ }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  const otherEmail = `tiny-city-other-${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Display name').fill('Another Builder');
  await page.getByLabel('Email').fill(otherEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
  const otherVerificationToken = await latestToken(request, otherEmail, 'Verify your TINY CITY email');
  await page.goto(`/verify-email#token=${otherVerificationToken}`);
  await expect(page.getByRole('status')).toContainText('Email verified');
  await page.getByRole('button', { name: 'Continue to sign in' }).click();
  await page.getByLabel('Email').fill(otherEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: /Another Builder/ })).toBeVisible();
  await page.getByRole('button', { name: 'Cloud', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My cities' })).toBeVisible();
  await expect(page.locator('.cloud-save-card')).toHaveCount(0);
  const crossAccountStatus = await page.evaluate(async ({ apiUrl, saveId }) => {
    const response = await fetch(`${apiUrl}/v1/users/me/cities/${encodeURIComponent(saveId)}`, { credentials: 'include' });
    return response.status;
  }, { apiUrl: API, saveId: ownerSaveId! });
  expect(crossAccountStatus).toBe(404);
});
