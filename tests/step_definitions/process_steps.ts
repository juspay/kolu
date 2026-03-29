/**
 * Foreground process indicator — step definitions.
 *
 * Tests that the sidebar shows the active foreground process name
 * when a command is running in a terminal.
 */

import { When, Then } from "@cucumber/cucumber";
import * as assert from "node:assert";
import { KoluWorld } from "../support/world.ts";
import { pollUntil } from "../support/poll.ts";

When("I send Ctrl+C to the terminal", async function (this: KoluWorld) {
  await this.page.keyboard.press("Control+c");
});

Then(
  "the sidebar should show process {string}",
  async function (this: KoluWorld, expected: string) {
    const indicator = this.page.locator(
      '[data-testid="sidebar"] [data-testid="process-indicator"]',
    );
    const text = await pollUntil(
      this.page,
      async () => {
        try {
          return (await indicator.first().textContent()) ?? "";
        } catch {
          return "";
        }
      },
      (t) => t.trim() === expected,
      { attempts: 30, intervalMs: 500 },
    );
    assert.strictEqual(
      text.trim(),
      expected,
      `Expected process indicator "${expected}", got "${text.trim()}"`,
    );
  },
);

Then(
  "the sidebar should not show a process indicator",
  async function (this: KoluWorld) {
    const indicator = this.page.locator(
      '[data-testid="sidebar"] [data-testid="process-indicator"]',
    );
    const count = await pollUntil(
      this.page,
      async () => {
        try {
          return await indicator.count();
        } catch {
          return 0;
        }
      },
      (c) => c === 0,
      { attempts: 30, intervalMs: 500 },
    );
    assert.strictEqual(
      count,
      0,
      `Expected no process indicator but found ${count}`,
    );
  },
);
