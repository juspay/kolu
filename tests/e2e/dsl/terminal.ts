/**
 * TerminalView and AppView implementations.
 *
 * Wraps Playwright page interactions with high-level terminal-specific methods.
 */

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type { TerminalView, AppView } from './types';

const DEFAULT_READY_TIMEOUT = 15_000;
const REFLOW_SETTLE_MS = 1000;

export class TerminalViewImpl implements TerminalView {
  canvas;

  constructor(private page: Page) {
    this.canvas = page.locator('canvas');
  }

  async waitForReady(opts?: { timeout?: number }) {
    const timeout = opts?.timeout ?? DEFAULT_READY_TIMEOUT;
    await expect(this.canvas).toBeVisible({ timeout });
  }

  async type(text: string) {
    await this.page.keyboard.type(text);
  }

  async enter() {
    await this.page.keyboard.press('Enter');
  }

  async run(command: string) {
    await this.type(command);
    await this.enter();
  }

  async boundingBox() {
    const box = await this.canvas.boundingBox();
    if (!box) throw new Error('Canvas has no bounding box');
    return box;
  }

  async resizeViewport(width: number, height: number) {
    await this.page.setViewportSize({ width, height });
    await this.page.waitForTimeout(REFLOW_SETTLE_MS);
  }

  async zoomIn() {
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await this.page.keyboard.press(`${mod}+Equal`);
    await this.page.waitForTimeout(300);
  }

  async zoomOut() {
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await this.page.keyboard.press(`${mod}+Minus`);
    await this.page.waitForTimeout(300);
  }

  async fontSize() {
    const container = this.page.locator('[data-font-size]');
    const val = await container.getAttribute('data-font-size');
    if (!val) throw new Error('No data-font-size attribute found');
    return parseFloat(val);
  }
}

export class AppViewImpl implements AppView {
  terminal: TerminalView;
  errors: string[] = [];

  constructor(public page: Page) {
    this.terminal = new TerminalViewImpl(page);
    page.on('pageerror', (err) => this.errors.push(err.message));
  }

  async wsStatus() {
    const el = this.page.locator('header span').last();
    return (await el.textContent()) ?? '';
  }
}
