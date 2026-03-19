import { test, expect } from '@playwright/test';

test('page loads with branding and terminal', async ({ page }) => {
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.goto('/');
  // Header shows app name
  await expect(page.locator('header')).toContainText('kolu', { timeout: 15_000 });
  // Terminal canvas renders
  await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });
});

test('health endpoint returns kolu', async ({ page }) => {
  const response = await page.request.get('/api/health');
  expect(response.ok()).toBeTruthy();
  expect(await response.text()).toBe('kolu');
});
