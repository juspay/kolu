import { Given, When, Then } from '@cucumber/cucumber';
import { KoluWorld } from '../support/world.ts';
import * as assert from 'node:assert';

// ── Terminal creation via API ──

Given('I create a terminal', async function (this: KoluWorld) {
  // Navigate if not already on the app
  if (!this.page.url().includes('localhost')) {
    await this.page.goto('/');
  }
  const { status, body } = await this.createTerminalApi();
  assert.strictEqual(status, 200, `Expected 200 creating terminal, got ${status}`);
  // Wait for sidebar poll to pick it up
  await this.page.waitForTimeout(4000);
  // Click the terminal in sidebar to select it
  const entry = this.page.locator(`aside >> text=${body.label}`);
  await entry.click();
  await this.page.waitForTimeout(500);
  // Store for later reference
  this.lastCreatedTerminal = body;
});

Given('I create another terminal', async function (this: KoluWorld) {
  const { status, body } = await this.createTerminalApi();
  assert.strictEqual(status, 200, `Expected 200 creating terminal, got ${status}`);
  await this.page.waitForTimeout(4000);
  const entry = this.page.locator(`aside >> text=${body.label}`).last();
  await entry.click();
  await this.page.waitForTimeout(500);
  this.lastCreatedTerminal = body;
});

// ── Switching ──

When('I switch to the first terminal in the sidebar', async function (this: KoluWorld) {
  const terminals = await this.listTerminalsApi();
  assert.ok(terminals.length > 0, 'No terminals found');
  const entry = this.page.locator(`aside >> text=${terminals[0].label}`).first();
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

When('I kill the last created terminal via the sidebar', async function (this: KoluWorld) {
  assert.ok(this.lastCreatedTerminal, 'No terminal was created');
  const id = this.lastCreatedTerminal.id;
  const status = await this.killTerminalApi(id);
  assert.strictEqual(status, 200, `Expected 200 killing terminal, got ${status}`);
  await this.page.waitForTimeout(500);
});

Then('the killed terminal should be removed', async function (this: KoluWorld) {
  assert.ok(this.lastCreatedTerminal, 'No terminal was created');
  const terminals = await this.listTerminalsApi();
  const found = terminals.find((t: any) => t.id === this.lastCreatedTerminal.id);
  assert.ok(!found, `Terminal ${this.lastCreatedTerminal.id} should have been removed after kill`);
});
