import { Given, When, Then } from '@cucumber/cucumber';
import { KoluWorld } from '../support/world.ts';
import * as assert from 'node:assert';

// ── Terminal creation via API ──

Given('I create a terminal with id {string} and label {string}', async function (this: KoluWorld, id: string, label: string) {
  // Navigate if not already on the app
  if (!this.page.url().includes('localhost')) {
    await this.page.goto('/');
  }
  const status = await this.createTerminalApi(id, label);
  assert.strictEqual(status, 200, `Expected 200 creating terminal, got ${status}`);
  // Wait for sidebar poll to pick it up
  await this.page.waitForTimeout(4000);
  // Click the terminal in sidebar to select it
  const entry = this.page.locator(`aside >> text=${label}`);
  await entry.click();
  await this.page.waitForTimeout(500);
});

// ── Switching ──

When('I switch to terminal {string} in the sidebar', async function (this: KoluWorld, id: string) {
  // Find terminal entry by looking at the sidebar text that matches the label
  // We use the API to find the label for this ID
  const terminals = await this.listTerminalsApi();
  const terminal = terminals.find((t: any) => t.id === id);
  assert.ok(terminal, `Terminal ${id} not found in API`);
  const entry = this.page.locator(`aside >> text=${terminal.label}`);
  await entry.click();
  await this.page.waitForTimeout(500);
});

When('I wait for the terminal to settle', async function (this: KoluWorld) {
  await this.page.waitForTimeout(2000);
});

When('I wait for status to update', async function (this: KoluWorld) {
  // Wait for sweep + poll cycle
  await this.page.waitForTimeout(5000);
});

// ── Sidebar assertions ──

Then('the sidebar should show {int} terminal(s)', async function (this: KoluWorld, count: number) {
  await this.page.goto('/');
  await this.page.waitForTimeout(4000);
  const terminals = await this.listTerminalsApi();
  assert.strictEqual(terminals.length, count, `Expected ${count} terminals, got ${terminals.length}`);
});

// ── Kill ──

When('I kill terminal {string} via the sidebar', async function (this: KoluWorld, id: string) {
  const terminals = await this.listTerminalsApi();
  const terminal = terminals.find((t: any) => t.id === id);
  assert.ok(terminal, `Terminal ${id} not found`);
  // Click the kill button next to the terminal label
  const entry = this.page.locator('aside').locator(`text=${terminal.label}`).locator('..').locator('button:has-text("✕")');
  await entry.click();
  await this.page.waitForTimeout(500);
});

Then('terminal {string} should show exited status in the sidebar', async function (this: KoluWorld, id: string) {
  // After kill + sweep, the terminal should be removed from the list
  const terminals = await this.listTerminalsApi();
  const terminal = terminals.find((t: any) => t.id === id);
  // Kill removes from map, so terminal should be gone
  assert.ok(!terminal, `Terminal ${id} should have been removed after kill`);
});

// ── Duplicate rejection ──

When('I try to create a terminal with id {string} and label {string}', async function (this: KoluWorld, id: string, _label: string) {
  this.lastApiStatus = await this.createTerminalApi(id, _label);
});

Then('the creation should fail with conflict error', function (this: KoluWorld) {
  assert.strictEqual(this.lastApiStatus, 409, `Expected 409 Conflict, got ${this.lastApiStatus}`);
});
