import { test, expect } from '@playwright/test';
import { scenario } from './dsl';

scenario('page loads with branding and terminal', async ({ app }) => {
  await expect(app.page.locator('header')).toContainText('kolu');
});

test('health endpoint returns kolu', async ({ page }) => {
  const response = await page.request.get('/api/health');
  expect(response.ok()).toBeTruthy();
  expect(await response.text()).toBe('kolu');
});
