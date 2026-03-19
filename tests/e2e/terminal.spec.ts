import { expect } from '@playwright/test';
import { scenario } from './dsl';

scenario('terminal accepts input', async ({ app }) => {
  await app.terminal.run('echo kolu-test');
  // Canvas-based terminal doesn't expose text to DOM —
  // verify it stays visible and no page errors occur.
  await app.page.waitForTimeout(1000);
  await expect(app.terminal.canvas).toBeVisible();
  expect(app.errors).toEqual([]);
});

scenario('terminal resizes with viewport', async ({ app }) => {
  const initial = await app.terminal.boundingBox();

  // Shrink viewport
  await app.terminal.resizeViewport(800, 400);
  const small = await app.terminal.boundingBox();
  expect(small.width).toBeLessThan(initial.width);
  expect(small.height).toBeLessThan(initial.height);

  // Grow viewport
  await app.terminal.resizeViewport(1400, 900);
  const large = await app.terminal.boundingBox();
  expect(large.width).toBeGreaterThan(small.width);
  expect(large.height).toBeGreaterThan(small.height);

  expect(app.errors).toEqual([]);
});
