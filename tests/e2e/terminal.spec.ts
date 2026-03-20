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

scenario('terminal canvas fills its container', async ({ app }) => {
  const canvas = await app.terminal.boundingBox();
  const container = await app.terminal.containerBox();

  // Canvas should fill at least 90% of the container in both dimensions
  expect(canvas.width).toBeGreaterThan(container.width * 0.9);
  expect(canvas.height).toBeGreaterThan(container.height * 0.9);

  expect(app.errors).toEqual([]);
});

scenario('terminal still fills container after zoom', async ({ app }) => {
  // Zoom in twice
  await app.terminal.zoomIn();
  await app.terminal.zoomIn();

  const canvas = await app.terminal.boundingBox();
  const container = await app.terminal.containerBox();

  expect(canvas.width).toBeGreaterThan(container.width * 0.9);
  expect(canvas.height).toBeGreaterThan(container.height * 0.9);

  // Zoom out three times
  await app.terminal.zoomOut();
  await app.terminal.zoomOut();
  await app.terminal.zoomOut();

  const canvas2 = await app.terminal.boundingBox();
  const container2 = await app.terminal.containerBox();

  expect(canvas2.width).toBeGreaterThan(container2.width * 0.9);
  expect(canvas2.height).toBeGreaterThan(container2.height * 0.9);

  expect(app.errors).toEqual([]);
});

scenario('zoom shortcuts do not leak keystrokes to terminal', async ({ app }) => {
  // Capture WS messages sent from client to server
  const sentMessages: string[] = [];
  await app.page.evaluate(() => {
    const origSend = WebSocket.prototype.send;
    (window as any).__wsSent = [];
    WebSocket.prototype.send = function (data: any) {
      if (typeof data === 'string') {
        (window as any).__wsSent.push(data);
      }
      return origSend.call(this, data);
    };
  });

  // Clear any prior messages then zoom
  await app.page.evaluate(() => { (window as any).__wsSent = []; });
  await app.terminal.zoomIn();
  await app.terminal.zoomOut();

  const messages: string[] = await app.page.evaluate(() => (window as any).__wsSent);

  // Only Resize JSON messages should have been sent — no raw "=" or "-" keystrokes
  for (const msg of messages) {
    expect(msg).not.toBe('=');
    expect(msg).not.toBe('-');
    expect(msg).not.toBe('+');
  }

  expect(app.errors).toEqual([]);
});

scenario('Cmd/Ctrl+Plus zooms in, Cmd/Ctrl+Minus zooms out', async ({ app }) => {
  const initial = await app.terminal.fontSize();

  await app.terminal.zoomIn();
  const bigger = await app.terminal.fontSize();
  expect(bigger).toBeGreaterThan(initial);

  await app.terminal.zoomOut();
  await app.terminal.zoomOut();
  const smaller = await app.terminal.fontSize();
  expect(smaller).toBeLessThan(initial);

  expect(app.errors).toEqual([]);
});
