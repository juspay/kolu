import { test, expect } from '@playwright/test';

test('page loads and shows kolu', async ({ page }) => {
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('kolu', { timeout: 15_000 });
});

test('health endpoint returns kolu', async ({ page }) => {
  const response = await page.request.get('/api/health');
  expect(response.ok()).toBeTruthy();
  expect(await response.text()).toBe('kolu');
});
