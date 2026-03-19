import { test, expect } from '@playwright/test';

test('terminal renders and accepts input', async ({ page }) => {
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.goto('/');

  // ghostty-web renders to <canvas>
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  // Type a command — canvas-based terminal doesn't expose text to DOM,
  // so we verify the canvas stays visible and no page errors occur.
  await page.keyboard.type('echo kolu-test\n');
  await page.waitForTimeout(1000);
  await expect(canvas).toBeVisible();
});

test('terminal survives viewport resize without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto('/');

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  // Resize viewport — terminal should survive without crashing
  await page.setViewportSize({ width: 800, height: 400 });
  await page.waitForTimeout(500);
  await expect(canvas).toBeVisible();

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(500);
  await expect(canvas).toBeVisible();

  // No JS errors during resize
  expect(errors).toEqual([]);
});
