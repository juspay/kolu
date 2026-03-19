import { test, expect } from '@playwright/test';

test('page loads and shows kolu', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('kolu');
});

test('health endpoint returns kolu', async ({ page }) => {
  const response = await page.request.get('/api/health');
  expect(response.ok()).toBeTruthy();
  expect(await response.text()).toBe('kolu');
});
